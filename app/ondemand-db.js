'use strict';
/*
 * ondemand-db.js
 *
 * Serves what a BUILD_WITH_FETCH engine asks for at runtime, under hashed
 * filenames:
 *
 *   1. OCR language models        GET /<sha256hex(basename)>
 *      e.g. sha256("OCRModel.Amharic.dat") = 9919cac1208a31f5...
 *   2. Per-document blobs         GET /<sha256hex(docId as 4 LE bytes)>
 *      assembled on the fly from IDRecognizer.dat + Lookup.dat, without ever
 *      extracting ~16k files to disk.
 *
 * Why this lives in the mock server rather than beside the engine: the SDK
 * page is served over HTTPS, so a model server on another port is both a
 * cross-origin request and — on plain HTTP — a mixed-content block the browser
 * refuses outright. Mounted here it inherits this server's origin, port and
 * certificate, and the engine's fetch simply works.
 *
 * The hashes must match three other implementations byte for byte:
 * OnDemandDB::sha256 in the C++ engine, the Rust model-splitter that uploads
 * the real blobs to S3, and ForCore/Scripts/{lang_model_server,docdb}.js.
 *
 * Formats (mirrored from model-splitter/src/readers.rs & commands/split.rs):
 *
 *   IDRecognizer.dat  (repeat until EOF):
 *       docId        : i32 LE
 *       recLen       : i32 LE
 *       recBytes     : recLen bytes
 *
 *   Lookup.dat:
 *       headerLen    : u64 LE
 *       header       : zlib-compressed, headerLen bytes
 *         (repeat)   nameLen   : u64 LE   (only low 32 bits used)
 *                    name      : nameLen bytes  ("<docId>.json")
 *                    dataOffset: u64 LE   (low 32 bits; relative to data section)
 *                    dataLength: u64 LE   (low 32 bits)
 *       dataSection  : starts at file offset (8 + headerLen); slices are opaque
 *
 *   Served blob per doc:
 *       [docId i32 LE][recLen u32 LE][recBytes][lookupLen u32 LE][lookupBytes]
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

/** Lowercase hex, matching CryptoPP HexEncoder(..., false) in the C++ client. */
function sha256Hex(str) {
    return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

/** The docId's 4 signed little-endian bytes, hashed — not its decimal string. */
function docIdHash(docId) {
    const b = Buffer.allocUnsafe(4);
    b.writeInt32LE(docId | 0, 0);
    return crypto.createHash('sha256').update(b).digest('hex');
}

// --- IDRecognizer.dat -> Map<docId, {off, len}> into recBuf ------------------
function parseRecognizers(recBuf) {
    const map = new Map();
    let pos = 0;
    const n = recBuf.length;
    while (pos < n) {
        if (pos + 8 > n) {
            throw new Error(`IDRecognizer truncated header at offset ${pos}`);
        }
        const docId = recBuf.readInt32LE(pos);
        const len = recBuf.readInt32LE(pos + 4);
        pos += 8;
        if (len < 0 || pos + len > n) {
            throw new Error(`IDRecognizer bad record: docId=${docId} len=${len} at ${pos}`);
        }
        map.set(docId, { off: pos, len });
        pos += len;
    }
    return map;
}

// --- Lookup.dat -> Map<docId, {off, len}> into lookupBuf ---------------------
function parseLookup(lookupBuf) {
    if (lookupBuf.length < 8) throw new Error('Lookup.dat too small');
    const headerLen = Number(lookupBuf.readBigUInt64LE(0));
    const dataSectionStart = 8 + headerLen; // slices are relative to here
    if (dataSectionStart > lookupBuf.length) {
        throw new Error(`Lookup header length ${headerLen} exceeds file`);
    }
    const header = zlib.inflateSync(lookupBuf.subarray(8, dataSectionStart));

    const dataSectionLen = lookupBuf.length - dataSectionStart;
    const map = new Map();
    let pos = 0;
    const h = header.length;
    let skipped = 0;
    while (pos < h) {
        if (pos + 8 > h) break;
        // nameLen/offset/length are u64 on disk; the Rust reader uses only the
        // low 32 bits, so read those and step a full 8.
        const nameLen = header.readUInt32LE(pos);
        pos += 8;
        if (pos + nameLen > h) throw new Error(`Lookup header truncated name at ${pos}`);
        const name = header.toString('utf8', pos, pos + nameLen);
        pos += nameLen;
        if (pos + 16 > h) throw new Error(`Lookup header truncated entry at ${pos}`);
        const dataOffset = header.readUInt32LE(pos);
        pos += 8;
        const dataLength = header.readUInt32LE(pos);
        pos += 8;

        if (!name.endsWith('.json')) {
            skipped++;
            continue;
        }
        const stem = name.slice(0, -'.json'.length);
        // DocId::from_str parses an i32; reject anything non-integer.
        if (!/^-?\d+$/.test(stem)) {
            skipped++;
            continue;
        }
        const docId = Number(stem) | 0;
        if (dataOffset + dataLength > dataSectionLen) {
            throw new Error(
                `Lookup data OOB for docId=${docId}: off=${dataOffset} len=${dataLength} > ${dataSectionLen}`
            );
        }
        map.set(docId, { off: dataSectionStart + dataOffset, len: dataLength });
    }
    return { map, skipped };
}

/**
 * Both .dat files held in memory once, read-only. Per doc we keep only offsets
 * and lengths into those buffers; the blob is assembled per request.
 */
class DocDb {
    constructor(recognizersPath, lookupPath) {
        this.recognizersPath = recognizersPath;
        this.lookupPath = lookupPath;

        this.recBuf = fs.readFileSync(recognizersPath);
        this.lookupBuf = fs.readFileSync(lookupPath);

        this.recognizers = parseRecognizers(this.recBuf);
        const { map: lookup, skipped } = parseLookup(this.lookupBuf);
        this.lookup = lookup;
        this.lookupSkipped = skipped;

        // A doc is served only when BOTH files have it, which is exactly when
        // model-splitter would have emitted it.
        this.routes = new Map(); // hash -> docId
        this.recOnly = [];
        for (const docId of this.recognizers.keys()) {
            if (!this.lookup.has(docId)) {
                this.recOnly.push(docId);
                continue;
            }
            this.routes.set(docIdHash(docId), docId);
        }
        this.lookupOnly = [...this.lookup.keys()].filter((id) => !this.recognizers.has(id));
    }

    /** Content-Length without building the blob, for HEAD. */
    blobSize(docId) {
        const rec = this.recognizers.get(docId);
        const lk = this.lookup.get(docId);
        if (!rec || !lk) return null;
        return 12 + rec.len + lk.len; // docId(4) + recLen(4) + rec + lookupLen(4) + lookup
    }

    buildBlob(docId) {
        const rec = this.recognizers.get(docId);
        const lk = this.lookup.get(docId);
        if (!rec || !lk) return null;

        const head = Buffer.allocUnsafe(8);
        head.writeInt32LE(docId | 0, 0);
        head.writeUInt32LE(rec.len, 4);

        const mid = Buffer.allocUnsafe(4);
        mid.writeUInt32LE(lk.len, 0);

        return Buffer.concat(
            [
                head,
                this.recBuf.subarray(rec.off, rec.off + rec.len),
                mid,
                this.lookupBuf.subarray(lk.off, lk.off + lk.len),
            ],
            12 + rec.len + lk.len
        );
    }

    stats() {
        return {
            recognizers: this.recognizers.size,
            lookup: this.lookup.size,
            served: this.routes.size,
            recognizerOnly: this.recOnly.length,
            lookupOnly: this.lookupOnly.length,
            lookupSkippedNames: this.lookupSkipped,
            memoryBytes: this.recBuf.length + this.lookupBuf.length,
        };
    }
}

/**
 * Builds the hash -> entry route table.
 *
 * Never throws: a missing models directory or an unreadable .dat pair is
 * reported and whatever else was found is still served, so a mock server does
 * not refuse to start over a DB the caller may not even need. Check
 * `routes.size` when you need there to be something.
 *
 * @returns {{routes: Map, langModels: Array, docdb: DocDb|null, dir: string, ext: string}}
 */
function buildRoutes(opts = {}) {
    const dir = path.resolve(opts.dir || '');
    const ext = (opts.ext || '.dat').toLowerCase();

    const routes = new Map(); // hash -> { kind: 'file'|'doc', ... }
    const langModels = []; // [{ file, hash }]
    let docdb = null;

    let entries = null;
    try {
        entries = fs.readdirSync(dir);
    } catch (err) {
        console.warn(`[ondemand] cannot read language-models dir ${dir}: ${err.message}`);
    }
    for (const name of entries || []) {
        if (!name.toLowerCase().endsWith(ext)) continue;
        const abs = path.join(dir, name);
        let stat;
        try {
            stat = fs.statSync(abs);
        } catch {
            continue;
        }
        if (!stat.isFile()) continue;
        const hash = sha256Hex(name); // of the basename, e.g. "OCRModel.Amharic.dat"
        routes.set(hash, { kind: 'file', file: name, path: abs });
        langModels.push({ file: name, hash });
    }
    langModels.sort((a, b) => a.file.localeCompare(b.file));

    if (opts.docdb !== false) {
        const pairs = [
            ['IDRecognizer.dat', opts.recognizers],
            ['Lookup.dat', opts.lookup],
        ];
        const missing = pairs.filter(([, p]) => !p || !fs.existsSync(p));
        if (missing.length) {
            for (const [label, p] of missing) {
                console.warn(`[ondemand] ${label} not found at ${p} — per-document serving disabled`);
            }
        } else {
            try {
                const t0 = process.hrtime.bigint();
                docdb = new DocDb(opts.recognizers, opts.lookup);
                docdb.loadMs = Number(process.hrtime.bigint() - t0) / 1e6;
                for (const [hash, docId] of docdb.routes) {
                    routes.set(hash, { kind: 'doc', docId });
                }
            } catch (err) {
                console.warn(`[ondemand] could not load the document DB: ${err.message}`);
                docdb = null;
            }
        }
    }

    return { routes, langModels, docdb, dir, ext };
}

/** One line for the startup log. */
function summarize(state) {
    const docs = state.docdb ? state.docdb.routes.size : 0;
    const mb = state.docdb ? (state.docdb.stats().memoryBytes / 1e6).toFixed(0) : 0;
    return (
        `${state.langModels.length} language model(s), ${docs} document(s)` +
        (state.docdb ? ` (${mb} MB resident, parsed in ${state.docdb.loadMs.toFixed(0)} ms)` : '')
    );
}

function manifest(state) {
    const obj = { languageModels: {}, documents: {} };
    for (const { file, hash } of state.langModels) obj.languageModels[file] = hash;
    if (state.docdb) {
        const ids = [...state.docdb.routes.values()].sort((a, b) => a - b);
        for (const docId of ids) obj.documents[docId] = docIdHash(docId);
    }
    return obj;
}

/**
 * Express middleware serving the route table.
 *
 * Mount it under a prefix — `app.use('/models', createHandler(state))` — and
 * point the session's `engines_base_url` at that same prefix. The engine
 * appends `/<hash>?<signed query>` and ignores everything else about the URL.
 *
 * @param opts.manifest expose GET <prefix>/manifest.json (default false)
 */
function createHandler(state, opts = {}) {
    const { routes, langModels, docdb, ext } = state;
    const exposeManifest = !!opts.manifest;

    return (req, res, next) => {
        const method = req.method || 'GET';

        if (method !== 'GET' && method !== 'HEAD') {
            return next();
        }

        // Express strips the mount prefix, so this is already "/<hash>".
        let pathname;
        try {
            pathname = decodeURIComponent(req.path || '/');
        } catch {
            return res.status(400).type('text/plain').send('Bad Request\n');
        }

        if (pathname === '/' || pathname === '/health') {
            const docCount = docdb ? docdb.routes.size : 0;
            return res
                .type('text/plain')
                .send(`ok — ${langModels.length} language model(s), ${docCount} document(s)\n`);
        }

        if (pathname === '/manifest.json') {
            if (!exposeManifest) return next();
            return res.json(manifest(state));
        }

        const key = pathname.replace(/^\/+/, '').toLowerCase();
        const info = routes.get(key);

        // Not one of ours — let the rest of the app have it rather than
        // answering 404 on its behalf.
        if (!info) return next();

        if (info.kind === 'file') {
            let size;
            try {
                size = fs.statSync(info.path).size;
            } catch (err) {
                console.error(`[ondemand] ${info.file}: ${err.message}`);
                return res.status(500).type('text/plain').send('Internal Server Error\n');
            }
            res.set({
                'Content-Type': 'application/octet-stream',
                'Content-Length': size,
                'Content-Disposition': `attachment; filename="${key}${ext}"`,
                'Cache-Control': 'no-store',
            });
            if (method === 'HEAD') return res.end();

            console.log(`[ondemand] lang ${info.file} (${size} bytes)`);
            const stream = fs.createReadStream(info.path);
            stream.on('error', (err) => {
                console.error(`[ondemand] stream error for ${info.file}: ${err.message}`);
                res.destroy(err);
            });
            req.on('close', () => stream.destroy());
            return stream.pipe(res);
        }

        const size = docdb.blobSize(info.docId);
        if (size == null) {
            console.error(`[ondemand] docId ${info.docId} missing data`);
            return res.status(500).type('text/plain').send('Internal Server Error\n');
        }
        res.set({
            'Content-Type': 'application/octet-stream',
            'Content-Length': size,
            'Content-Disposition': `attachment; filename="${key}"`,
            'Cache-Control': 'no-store',
        });
        if (method === 'HEAD') return res.end();

        console.log(`[ondemand] doc ${info.docId} (${size} bytes)`);
        return res.end(docdb.buildBlob(info.docId));
    };
}

module.exports = { buildRoutes, createHandler, summarize, manifest, sha256Hex, docIdHash, DocDb };
