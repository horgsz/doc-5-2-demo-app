const express = require('express');
const cors = require('cors');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const bodyParser = require('body-parser');
const multer = require('multer');
const onDemand = require('./ondemand-db');

// Get local IP address dynamically
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            // Skip internal and non-IPv4 addresses
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}

const uploadsDir = path.join(__dirname, 'uploads', 'videos');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

const videoStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`),
});

const videoUpload = multer({
    storage: videoStorage,
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('video/')) {
            cb(null, true);
        } else {
            cb(new Error('Only video files are allowed'));
        }
    },
});

const app = express();
const port = Number(process.env.PORT) || 8084;

// Behind a reverse proxy the scheme the browser used is only in X-Forwarded-*,
// and every URL this server hands back has to match it or the SDK loads its
// engine from the wrong origin.
app.set('trust proxy', true);

// The harness's engine switch. A session started under /e6 ("Engine: 6.0") is
// the same session API, but /initialise hands it the 6.0 engine's module URLs
// (served from /wasm6). The prefix is stripped here, before any route, so every
// endpoint answers under it unchanged.
app.use((req, res, next) => {
    if (req.url === '/e6' || req.url.startsWith('/e6/')) {
        req.engine6 = true;
        req.url = req.url.slice(3) || '/';
    }
    next();
});

/**
 * The origin the browser actually reached this server on.
 *
 * Every URL returned to the SDK -- engine, worker, upload links -- has to be
 * reachable from the browser, which is not the same as reachable from here.
 * Deriving it from the request means the same build works on localhost, on a
 * LAN address and on a deployed host without being rebuilt. PUBLIC_ORIGIN
 * overrides it for the case where the proxy does not pass the headers on.
 */
function publicOrigin(req) {
    if (process.env.PUBLIC_ORIGIN) {
        return process.env.PUBLIC_ORIGIN.replace(/\/+$/, '');
    }
    return `${req.protocol}://${req.get('host')}`;
}
const useSessionAPI = false;
// const baseAPI_URL = 'https://zak-1.sessions.au.staging.idverse.tech/v1';
const baseAPI_URL = 'https://lahsen-test.sessions.au.dev9.idverse.tech/v1';
const IP = process.env.SERVER_IP || getLocalIP();

const https = require('https');
const http = require('http');

/**
 * Self-signed certificate, when there is one next to this file.
 *
 * The camera needs a secure context, so serving TLS directly is what makes
 * local testing work at all. A deployed copy usually sits behind a proxy that
 * has already terminated TLS -- there the certificate is absent and plain HTTP
 * is correct, because the browser still sees https. Paths are resolved against
 * this file rather than the working directory so it runs from anywhere.
 */
function loadCertificate() {
    const key = path.join(__dirname, 'key.pem');
    const cert = path.join(__dirname, 'cert.pem');

    // NO_TLS=1 serves plain HTTP even with a certificate present -- for a
    // browser that will not accept the self-signed one (localhost only).
    if (process.env.NO_TLS || !fs.existsSync(key) || !fs.existsSync(cert)) {
        return null;
    }

    return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}

const httpsOptions = loadCertificate();

/**
 * Directory served as the web root.
 *
 * Resolved against this file rather than the working directory, so the server
 * runs correctly from anywhere. WWW_ROOT overrides it for deployments that keep
 * the site and the server in separate directories.
 */
const wwwRoot = process.env.WWW_ROOT
    ? path.resolve(process.env.WWW_ROOT)
    : path.join(__dirname, 'www');

/**
 * On-demand model DB.
 *
 * A BUILD_WITH_FETCH engine ships with a stripped db-core-ort-size bundle and
 * fetches the rest at runtime: the per-document Lookup + IDRecognizer blob for
 * whatever it just detected, and an OCR language model the first time a
 * document needs one. Both arrive under hashed filenames, which is what
 * ondemand-db.js resolves.
 *
 * Two sources, in order:
 *
 *   1. a `models/` directory beside this file — what bundle-demo.sh assembles,
 *      so a deployed copy carries its own DB and depends on nothing outside
 *      itself;
 *   2. the working tree, for running from the repo. Those are the same three
 *      paths ForCore/Scripts/updateCoreDB.sh builds the engine bundle from, so
 *      what is served matches what the engine was compiled against.
 *
 * MODELS_DIR / RECOGNIZERS / LOOKUP override either; DOCDB=0 disables
 * per-document serving.
 */
const BUNDLED_MODELS = path.join(__dirname, 'models');
const DEV_LANG_MODELS = '/Users/lahsen/Documents/Work/OCREngine5.0/ForCore/Scripts/lang_models';
const DEV_CORE_DB = '/Users/lahsen/Documents/Work/OCREngine5.2/db';

function modelPath(envVar, bundledName, devPath) {
    if (process.env[envVar]) return path.resolve(process.env[envVar]);
    const bundled = path.join(BUNDLED_MODELS, bundledName);
    return fs.existsSync(bundled) ? bundled : devPath;
}

const modelDb = onDemand.buildRoutes({
    dir: modelPath('MODELS_DIR', 'lang_models', DEV_LANG_MODELS),
    recognizers: modelPath('RECOGNIZERS', 'IDRecognizer.dat', path.join(DEV_CORE_DB, 'IDRecognizer.dat')),
    lookup: modelPath('LOOKUP', 'Lookup.dat', path.join(DEV_CORE_DB, 'Lookup.dat')),
    docdb: process.env.DOCDB !== '0',
});

// Enable CORS for your API
app.use(
    cors({
        origin: '*',
    }),
);

app.use(express.json());

// One line per request. This is a test server whose whole job is to be watched
// while a client misbehaves; without it, a browser failing to fetch an asset is
// invisible from this side.
if (process.env.QUIET !== '1') {
    app.use((req, res, next) => {
        const started = Date.now();
        res.on('finish', () => {
            console.log(
                `${req.method} ${req.originalUrl} -> ${res.statusCode} ` +
                    `(${Date.now() - started}ms) ${req.get('user-agent') ? '' : '[no-ua]'}`,
            );
        });
        next();
    });
}

// ---------------------------------------------------------------------------
// Simulator support -- SIM=1 only, so a deployed copy is unchanged.
//
// Serves the virtual camera and the test driver (NewSDK/sim/www) under /sim,
// and lets a test make this server misbehave the way a real backend or network
// can: an error status, a delay, a request that never answers, a dropped
// connection, a session payload missing a field. Faults are set per test run:
//
//   POST /__sim/faults  {"initialise": "status:500", "engine": "delay:8000"}
//   POST /__sim/reset   clears faults and the upload log
//   GET  /__sim/uploads what the asset uploads delivered (count, sizes)
//
// A fault value is "status:<code>", "delay:<ms>", "hang", "drop" or, for
// initialise only, "missing:<field>". Prefix "once:" to apply it to the next
// matching request only.
// ---------------------------------------------------------------------------
const SIM = process.env.SIM === '1';
const simFaults = {};
const uploadLog = [];
const SIM_ROUTES = {
    initialise: /^\/initialise$/,
    uploadLinks: /^\/generate-upload-link$/,
    uploads: /^\/uploads\//,
    engine: /^\/wasm6?\/(basic\/)?IDVerseSDK\.(js|wasm|data)$/,
    worker: /IDVerseSDK\.worker\.min\.js$/,
    models: /^\/models\//,
    models6: /^\/models6\//,
    finalise: /^\/finalise$/,
    submit: /^\/upload-document$/,
};

if (SIM) {
    const simWww = path.resolve(process.env.SIM_WWW || path.join(__dirname, '..', 'sim', 'www'));
    app.use('/sim', express.static(simWww, { extensions: false }));
    // run reports (sim/out/<run>/report.html), for viewing in a browser
    app.use('/__sim/out', express.static(path.join(simWww, '..', 'out')));
    app.post('/__sim/faults', (req, res) => {
        Object.assign(simFaults, req.body || {});
        res.json(simFaults);
    });
    app.post('/__sim/reset', (req, res) => {
        for (const k of Object.keys(simFaults)) delete simFaults[k];
        uploadLog.length = 0;
        res.json({ ok: true });
    });
    app.get('/__sim/uploads', (req, res) => res.json(uploadLog));
    // the harness page has no icon; its 404 would read as an SDK request failing
    app.get('/favicon.ico', (req, res) => res.status(204).end());

    app.use((req, res, next) => {
        const name = Object.keys(simFaults).find(k => SIM_ROUTES[k] && SIM_ROUTES[k].test(req.path));
        if (!name) return next();

        let mode = String(simFaults[name]);
        if (mode.startsWith('once:')) {
            mode = mode.slice(5);
            delete simFaults[name];
        }
        const [kind, arg] = mode.split(/:(.*)/s);
        console.log(`[sim] fault ${name} -> ${mode} on ${req.method} ${req.originalUrl}`);

        if (kind === 'status') return res.status(Number(arg) || 500).send(`sim fault: ${name}`);
        if (kind === 'delay') return setTimeout(next, Number(arg) || 0);
        if (kind === 'hang') return; // never answers
        if (kind === 'drop') return req.socket.destroy();
        if (kind === 'missing' && name === 'initialise') {
            // Let the route answer, then take the field out of its body.
            const send = res.send.bind(res);
            res.send = body => {
                if (body && typeof body === 'object') delete body[arg];
                return send(body);
            };
            return next();
        }
        next();
    });
}

// The presigned upload links handed out above point here. A real backend
// returns S3 URLs; this receiver stands in for them so the upload path -- and
// the completion that waits on it -- can run against the mock at all. The body
// is counted and discarded, never held in memory.
app.put('/uploads/:id', (req, res) => {
    let size = 0;
    req.on('data', chunk => (size += chunk.length));
    req.on('end', () => {
        uploadLog.push({
            id: req.params.id,
            size,
            contentType: req.get('content-type') || '',
            at: new Date().toISOString(),
        });
        if (uploadLog.length > 200) uploadLog.shift();
        res.status(200).end();
    });
});

// The engine's on-demand fetches. Mounted on this server rather than run
// beside it so they share this origin and certificate -- a model server on
// another port would be cross-origin, and over plain HTTP the browser would
// refuse it outright as mixed content. `engines_base_url` below points here.
app.use('/models', onDemand.createHandler(modelDb, { manifest: true }));

// The 6.0 engine's own on-demand files, for sessions started under /e6. 6.0
// renumbered its documents and restructured its profiles, so it never shares
// 5.2's /models. The folder is OCREngine6.0's tools/splitdb/split_db.py
// output (hashed names: one file per document, one per non-Latin language
// net), and it must be the split the 6.0 build's .data was made from: the
// engine checks every file against its own checksums and refuses the rest.
const MODELS6_DIR = process.env.MODELS6_DIR
    ? path.resolve(process.env.MODELS6_DIR)
    : path.join(__dirname, 'models6');
const HASHED_NAME = /^\/[0-9a-f]{64}$/;
app.use('/models6', (req, res, next) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || !HASHED_NAME.test(req.path)) return next();
    const file = path.join(MODELS6_DIR, req.path.slice(1));
    fs.stat(file, (err, stat) => {
        if (err || !stat.isFile()) return res.status(404).end();
        res.set({
            'Content-Type': 'application/octet-stream',
            'Content-Length': stat.size,
            'Cache-Control': 'no-store',
        });
        if (req.method === 'HEAD') return res.end();
        fs.createReadStream(file).pipe(res);
    });
});

// Serve gzipped wasm files with proper headers. /wasm is the 5.2 engine, /wasm6
// the 6.0 one (see the /e6 switch above).
app.use(['/wasm', '/wasm6'], (req, res, next) => {
    const filePath = path.join(wwwRoot, req.baseUrl) + req.path;
    const gzPath = filePath + '.gz';

    // Check if gzipped version exists
    if (fs.existsSync(gzPath)) {
        // Set Content-Encoding
        res.set('Content-Encoding', 'gzip');

        // Set correct Content-Type based on original extension
        if (req.path.endsWith('.wasm')) {
            res.set('Content-Type', 'application/wasm');
        } else if (req.path.endsWith('.js')) {
            res.set('Content-Type', 'application/javascript');
        } else if (req.path.endsWith('.data')) {
            res.set('Content-Type', 'application/octet-stream');
        }

        return res.sendFile(path.resolve(gzPath));
    }
    next();
});

app.use(express.static(wwwRoot, { extensions: false }));

// Node-style extensionless resolution, so a bench can import the SDK's
// dist/collection output straight into a page.
//
// That output is plain ES modules, but its imports carry no file extension
// ("../../../utils/interface") -- fine for a bundler, unresolvable in a
// browser. Appending .js here is what lets a bench drive the real component
// class instead of a hand-written model of it.
//
// Only requests express.static could not serve reach this, so there is no
// extension test: several of these specifiers have a dot in the basename
// ("./id-scan.audio"), which path.extname reads as an extension.
app.use((req, res, next) => {
    const candidate = path.join(wwwRoot, req.path + '.js');

    // Keep the lookup inside the served root: req.path can contain "..".
    if (!path.resolve(candidate).startsWith(path.resolve(wwwRoot))) {
        return next();
    }

    fs.access(candidate, fs.constants.R_OK, err => {
        if (err) {
            return next();
        }

        res.type('application/javascript');
        res.sendFile(path.resolve(candidate));
    });
});

// Endpoint to generate pre-signed URL
app.post('/initialise', async (req, res) => {
    const origin = publicOrigin(req);
    const baseUrl = origin + '/wasm';
    // The ID-scan engine follows the harness's switch; face scan and the
    // device-info module are the same for both.
    const idBase = req.engine6 ? origin + '/wasm6' : baseUrl;
    console.log(`[initialise] engine ${req.engine6 ? '6.0' : '5.2'} (${idBase})`);
    // const baseUrl = 'https://app.idkit.com:8084/wasm';
    // const baseUrl = '/wasm';

    if (useSessionAPI) {
        // const { exec } = require('child_process');
        // exec(
        //     'bash /Users/lahsen/Documents/Work/OCREngine5.0/Source/build_core/createTX.sh',
        //     (error, stdout, stderr) => {
        //         if (error) {
        //             console.error(`Error executing script: ${error}`);
        //             return res.status(500).send('Error initializing transaction');
        //         }
        //         const [_, tx_id, token] = stdout.trim().split('\n');

                fetch(baseAPI_URL + '/initialise', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'transaction-token': req.headers['transaction-token'], // Pass through token or generate a new one
                    },
                    body: JSON.stringify({
                        engine5: true,
                        abi_version: '1',
                        device_info: {
                            os: 'android',
                            browser: 'chrome',
                            ip_address: '1.1.1.1',
                            user_agent: 'test',
                        },
                    }),
                })
                    .then((response) => response.json())
                    .then((data) => {

                        res.send({
                            ...data,
                            module_urls: {
                                ...data.module_urls,
                                'id-scan/simd': {
                                    loader: idBase + '/IDVerseSDK.js',
                                    engine: idBase + '/IDVerseSDK.wasm',
                                    data: idBase + '/IDVerseSDK.data',
                                    web_worker: baseUrl + '/IDVerseSDK.worker.min.js',
                                },
                                'face-scan/simd': {
                                    loader: baseUrl + '/IDVerseSDK.js',
                                    engine: baseUrl + '/IDVerseSDK.wasm',
                                    data: baseUrl + '/IDVerseSDK.data',
                                    web_worker: baseUrl + '/IDVerseSDK.worker.min.js',
                                },
                                // Non-SIMD build for Safari/iOS < 16.4 (getWasmMode -> basic).
                                'id-scan/basic': {
                                    loader: idBase + '/basic/IDVerseSDK.js',
                                    engine: idBase + '/basic/IDVerseSDK.wasm',
                                    data: idBase + '/basic/IDVerseSDK.data',
                                    web_worker: baseUrl + '/IDVerseSDK.worker.min.js',
                                },
                                'face-scan/basic': {
                                    loader: baseUrl + '/basic/IDVerseSDK.js',
                                    engine: baseUrl + '/basic/IDVerseSDK.wasm',
                                    data: baseUrl + '/basic/IDVerseSDK.data',
                                    web_worker: baseUrl + '/IDVerseSDK.worker.min.js',
                                },
                            }
                        });
                    })
                    .catch((error) => {
                        console.error('Error fetching base API:', error);
                        res.status(500).send('Error initializing transaction');
                    });
        //     },
        // );
    } else {
        res.send({
            engine_payload:
                'qAAAABAAAAC5R00Rw1j3HIEjT6Pxh159kAAAAICYs6jKxnotiVD1KxT/wcB/GbwPFHz7mSitA1n4KXciKlY56C5XBK/z2GbJPdG0FX5JewrvVizIRdVoL7QCstoy0g3yZlM4Td8m6Mp7ATKMKgudKNFd5ctSn6h1puESk0e4YpLJ6nsQ9VridT/TLR+0yagnUCtL3pMo1OY3r0sAWwzi5AHtKTOkYSAYOXr2JAACAAAiRWxdAOUxJCf1HUcqZB/uxG/MXQnF8y/awqYIHWFXsU2eX86p3DK+6IIyIzjGpzSvGXVVcur6DOmwk/RKuSOZV83Ov6RefFC1hVWtnPwXXmzChsENhdYyFWasZtkooeXGvyg5nwYXPMFO/z8c1NriEWY7CM3AEoKLZcEXNkjIerNm1G6H2LkwA913LDoYOERmFKparBqheKRNG9ZNsPxlW5mwyzNZufK5jr/St8itvVofguhqoKrb26De46svYASo0Te3QQXsLMYR5MHxLov8IbfHozwHB5a9bkhPPTXm0DhG4a1cwU1TTR2mzMr8U2acyHHWSt6sGvXyLkXCzXOyxXGsKdsUWigQ1QCGvGsQbfD3F5MyOVfpYFeq1r4A0W8+o+hByFhV8Souigw3v6BOfV+wXS150mLStaRDmYbORZ6CLMvzjROYKSHcEjs5oHSrrK4Vtf8QrZeJpaAxoqhP5AMNfbyV51opzPO3mokpKlgMI+gghptVoO8EmRviJUObwIs72rAXE8T6cggEN+fXIWfasluXm9kmr4Gz+vsu+rNZKbPYXx3hqNL5/HECnK1Z2UtJsV8sJSUjLIDwsKBH8xtE5dMV7SBIlM/mtQrGZdcAWfwfXSwDbq/BFEiz9e2ZosWknzl6Z7rYe8GDPt+GVwW2oi8VbTPyOUqlKgqj6Q==', // base64 payload
            module_urls: {
                'id-scan/simd': {
                    loader: idBase + '/IDVerseSDK.js',
                    engine: idBase + '/IDVerseSDK.wasm',
                    data: idBase + '/IDVerseSDK.data',
                    web_worker: null,
                },
                'face-scan/simd': {
                    loader: baseUrl + '/face-scan/IDVerseSDK.js',
                    engine: baseUrl + '/face-scan/IDVerseSDK.wasm',
                    data: baseUrl + '/face-scan/IDVerseSDK.data',
                    web_worker: baseUrl + '/IDVerseSDK.worker.min.js',
                },
                // Non-SIMD build for Safari/iOS < 16.4 (getWasmMode -> basic).
                // face-scan/basic mirrors face-scan/simd above so a basic device
                // resolves face-scan exactly as a simd one would.
                'id-scan/basic': {
                    loader: idBase + '/basic/IDVerseSDK.js',
                    engine: idBase + '/basic/IDVerseSDK.wasm',
                    data: idBase + '/basic/IDVerseSDK.data',
                    web_worker: null,
                },
                'face-scan/basic': {
                    loader: baseUrl + '/face-scan/IDVerseSDK.js',
                    engine: baseUrl + '/face-scan/IDVerseSDK.wasm',
                    data: baseUrl + '/face-scan/IDVerseSDK.data',
                    web_worker: baseUrl + '/IDVerseSDK.worker.min.js',
                },
                "p27850": {
                   loader: baseUrl + '/IDVerseSDK_bg.js',
                    engine: baseUrl + '/IDVerseSDK_bg.wasm',
                    data: null,
                    web_worker: null
                },
            },
            assets_upload_links: [
                origin + '/uploads/80e2e0d6-2b4c-44eb-832a-123bd44ea523',
                origin + '/uploads/16b466f7-4aaa-4a8f-ae9e-87f8631886e1',
                origin + '/uploads/fabf304d-237e-478a-a6ad-5ceb8aeb06e9',
                origin + '/uploads/1b4e00e5-bd46-4168-acc4-a3695456595d',
                origin + '/uploads/a1d38fc1-a03e-40b2-b07c-5f52c2aad7bc',
                origin + '/uploads/e8c49ef5-debd-47e8-8034-3cbe5963a77e',
                origin + '/uploads/675bc576-f342-4635-b1b5-da66c37f0e0a',
                origin + '/uploads/4ca83190-0dc9-4aab-8dce-1091f579dd46',
                origin + '/uploads/e1745eef-a481-4aec-b7b3-251424913e54',
                origin + '/uploads/5b4d0546-956e-400e-8802-973b17e7de1b',
                origin + '/uploads/ee0399d0-4965-59fd-9a3d-e2f2963cee1d',
                origin + '/uploads/fd5b3287-6280-5821-b4f4-0d81e9f43855',
                origin + '/uploads/5bb903ee-f2e3-5e23-a44d-4d2fd50b6683',
                origin + '/uploads/e690897e-a5c2-5f84-8e73-8b8b75751793',
            ],
            // The engine appends "/<hash>?<query>" to this. Same origin as the
            // page, so the fetch needs no CORS and cannot be blocked as mixed
            // content; it used to name port 8080, where a separate model server
            // had to be started by hand. 6.0 has its own files (see /models6).
            engines_base_url: origin + (req.engine6 ? '/models6' : '/models'),
            engines_signed_query: '?Token=abcd123',
            assets_public_encryption_key:
                'MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAoPNzDpoHKVs0AWS478qpFLilb5mzrhkizNfqe8D98+4GOVfT/Kb/2pna2FvosroqqLsXaOijkaAn5c3K/fF+Kw6pXv0knlDt/G3+VrOPmNVWB52gpKkpPUlHV0KPiPuERt4ESYe7z8fWrvrY9pYcbx9f8Te6L1BkVdeVniiHKFSiWKU7zjPTnsNse2xLVwaT8IrI6y5Xh6j5+hiW3IHRcPKo1Xcf+3JFTk0rplaFe6o6ZRhOywpo/mRFR2GYqP2RV7K5K3k/2lOdjrX446aWPDbq6o326mSTS211yRh80LiejGlnuZQiIFooKmEwVMWLS1X4t7RmAZu8UBXNFzrIqz3AD7imqnkTyvlOBowidOz6n1+WClQfmABRY7ikh20EmZlfDANLP3u1LKhwfGKfbNmNBApuQvi3HFJZOUe7y1Vr56jI/xYVLArkF3bt8y2tO1ChEGIBTIzaobt9wx+a63FNS2YOAWkfTohlcmwKaxbBnFrVRd2CwSkY/UTI2rF/LjMOqVfGqlON7LJ978Ktfdxq0BUD0Un52dZFhG93ukC1n4GSUXUoQVsRYDNoTJLJ42vw3age9ZReJdmFSSH5E1MOStKQ+0j00TdGjfg++Eh3g+/jVq106xJKwm8C1BXw7++S+dAHsZ+Ja/lRXSb4U3Zi0HZHrLCNepmjHNgfRv8CAwEAAQ==',
        });
    }
});

app.post('/generate-upload-link', async (req, res) => {
    if (useSessionAPI) {
        // call baseAPI_URL/generate-upload-link with fetch and return the result
        fetch(baseAPI_URL + '/generate-upload-link', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Transaction-token': req.headers['transaction-token'],
            },
            body: JSON.stringify(req.body),
        })
            .then((response) => response.json())
            .then((data) => {
                res.send(data);
            })
            .catch((error) => {
                console.error('Error fetching base API:', error);
                res.status(500).send('Error generating upload link');
            });
    } else {
        // Same origin as /initialise's links, so they reach the receiver above
        // wherever this server runs. They used to name https://<LAN IP>:8084,
        // which nothing answers behind a proxy or on another port.
        const origin = publicOrigin(req);
        const count = Math.min(Math.max(Number(req.body && req.body.links) || 10, 1), 50);
        res.send({
            assets_upload_links: Array.from({ length: count }, () => origin + '/uploads/' + uuidv4()),
            assets_public_encryption_key:
                'MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAoPNzDpoHKVs0AWS478qpFLilb5mzrhkizNfqe8D98+4GOVfT/Kb/2pna2FvosroqqLsXaOijkaAn5c3K/fF+Kw6pXv0knlDt/G3+VrOPmNVWB52gpKkpPUlHV0KPiPuERt4ESYe7z8fWrvrY9pYcbx9f8Te6L1BkVdeVniiHKFSiWKU7zjPTnsNse2xLVwaT8IrI6y5Xh6j5+hiW3IHRcPKo1Xcf+3JFTk0rplaFe6o6ZRhOywpo/mRFR2GYqP2RV7K5K3k/2lOdjrX446aWPDbq6o326mSTS211yRh80LiejGlnuZQiIFooKmEwVMWLS1X4t7RmAZu8UBXNFzrIqz3AD7imqnkTyvlOBowidOz6n1+WClQfmABRY7ikh20EmZlfDANLP3u1LKhwfGKfbNmNBApuQvi3HFJZOUe7y1Vr56jI/xYVLArkF3bt8y2tO1ChEGIBTIzaobt9wx+a63FNS2YOAWkfTohlcmwKaxbBnFrVRd2CwSkY/UTI2rF/LjMOqVfGqlON7LJ978Ktfdxq0BUD0Un52dZFhG93ukC1n4GSUXUoQVsRYDNoTJLJ42vw3age9ZReJdmFSSH5E1MOStKQ+0j00TdGjfg++Eh3g+/jVq106xJKwm8C1BXw7++S+dAHsZ+Ja/lRXSb4U3Zi0HZHrLCNepmjHNgfRv8CAwEAAQ==',
        });
    }
});

app.post('/upload-document', async (req, res) => {
    
    if (useSessionAPI) {
        fetch(baseAPI_URL + '/upload-document', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Transaction-Token': req.headers['transaction-token'],
            },
            body: JSON.stringify(req.body),
        })
            .then((response) => response.json())
            .then((data) => {
                res.send(data);
            })
            .catch((error) => {
                console.error('Error fetching base API:', error);
                res.status(500).send('Error uploading document');
            });
    } else {
        console.log(req.body.engine_results_payload);
        res.send({ document_id: 'c59bd492-96ab-5a00-aaee-4d509069b2a0' });
    }
});

app.post('/upload-face', async (req, res) => {
    console.log(req.body);
    res.send({ session_id: 'c59bd492-96ab-5a00-aaee-4d509069b2a0' });
});

app.post('/upload-video', videoUpload.single('video'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No video file provided' });
    }
    res.json({
        message: 'Video uploaded successfully',
        filename: req.file.filename,
        path: req.file.path,
        size: req.file.size,
    });
});

app.get('/download', (req, res) => {
    const filePath =
        '/Users/lahsen/Documents/Work/OCREngine5.0/DB/DBDecoder/model-optimizer/build/rec.zip'; // your file path
    res.download(filePath, 'rec.zip', (err) => {
        if (err) {
            console.error('Error sending file:', err);
            res.status(500).send('Failed to download file');
        } else {
            console.log('File sent successfully');
        }
    });
});

app.post('/finalise', async (req, res) => {
    console.log('Done');
    if (useSessionAPI) {
        fetch(baseAPI_URL + '/finalise', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Transaction-Token': req.headers['transaction-token'],
            },
            body: JSON.stringify(req.body),
        })
            .then((response) => response.json())
            .then((data) => {
                res.send(data);
            })
            .catch((error) => {
                console.error('Error fetching base API:', error);
                res.status(500).send('Error finalising transaction');
            });
    } else {
        res.send();
    }
});

const scheme = httpsOptions ? 'https' : 'http';
const server = httpsOptions
    ? https.createServer(httpsOptions, app)
    : http.createServer(app);

server.listen(port, '0.0.0.0', function () {
    console.log(`Server running at ${scheme}://${IP}:${port}`);
    console.log(`Server running at ${scheme}://localhost:${port}`);
    if (!httpsOptions) {
        console.log('No certificate found -- serving plain HTTP (expects TLS to be terminated upstream).');
    }
    // Worth a line: with a BUILD_WITH_FETCH engine, an empty table here shows
    // up much later as a document that will not recognise, and the only clue
    // is a 404 for a hash nobody can read.
    console.log(`On-demand models at /models -- ${onDemand.summarize(modelDb)}`);
    if (modelDb.routes.size === 0) {
        console.log('  [warn] nothing to serve; set MODELS_DIR / RECOGNIZERS / LOOKUP');
    }
    let files6 = 0;
    try {
        files6 = fs.readdirSync(MODELS6_DIR).filter(name => HASHED_NAME.test('/' + name)).length;
    } catch {}
    console.log(`On-demand 6.0 files at /models6 -- ${files6} file(s) from ${MODELS6_DIR}`);
});

// Start the server
// app.listen(port, () => {
//     console.log(`Server is running on http://localhost:${port}`);
// });
