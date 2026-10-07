// Importing error handling utilities
import { Browser } from './Browser';
import { ErrorCode, SdkError } from './SdkError';

// Enum defining authentication status
export enum SessionStatus {
  Invalid,
  Valid,
}

// Interface describing authentication credentials
export interface SessionCredentials {
  readonly url: string; // Authentication API URL
  readonly token: string; // Session ID
}

// Interface describing session information
export interface SessionResponse {
  // sdk type
  readonly sdk_type: string;
  // Base64 payload - deprecated but still being
  // sent to support older versions of the sdk
  readonly engine_payload: string;
  // Assets encryption key.
  readonly assets_public_encryption_key: string;
  // CloudFront Signed URLs
  readonly module_urls: {
    [key: string]: {
      loader: string;
      engine: string;
      web_worker: string;
      data: string;
    };
  };
  readonly assets_upload_links: string[];
  // Base url for the doc5 model files
  readonly engines_base_url: string;
  // Signed url query for the model files
  readonly engines_signed_query: string;
}

interface BaseSubmitPayload {
  results_payload_encrypted_key: string;
  engine_results_payload: string;
  results_payload_iv: string;
  engine5: boolean;
}

interface ExtendedSubmitPayload {
  [key: string]: any;
  results_payload_encrypted_key?: never;
  engine_results_payload?: never;
  results_payload_iv?: never;
}

// Class representing a session manager
export class Session {
  readonly apiBaseUrl: string;
  readonly token: string;

  constructor(apiBaseUrl: string, token: string) {
    this.apiBaseUrl = apiBaseUrl;
    this.token = token;
  }

  /**
   * Makes a request to the server to obtain permission.
   * @returns Promise<SessionResponse> Resolves with server response, rejects on network or server error.
   */
  public async getPermission(): Promise<SessionResponse> {
    return new Promise(async (resolve, reject) => {
      try {
        const { os, browser, user_agent } = await Browser.getBrowserInfo();
        // Make HTTP POST request to session API
        const response = await this.post('initialise', {
          abi_version: '1',
          device_info: {
            os,
            browser,
            user_agent,
          },
        });

        if (response.status === 200) {
          // Parse JSON response
          const responseJson = await response.json();
          resolve(responseJson as SessionResponse);
          return;
        }

        // Handle different server response states
        switch (response.status) {
          case 401:
            reject(new SdkError(ErrorCode.InvalidCredentials));
            break;
          case 404:
            reject(new SdkError(ErrorCode.SessionExpired));
            break;
          default:
            reject(new SdkError(ErrorCode.InternalError));
            break;
        }
      } catch (error) {
        return reject(new SdkError(ErrorCode.NetworkError, 'Error: ' + JSON.stringify(error)));
      }
    });
  }

  /**
   * Make HTTP POST request to submit the payload and finalise.
   * @param payload Request payload
   * @param payextendedPayloadForSubmitload additional data to extend payload
   */
  public async submit(
    payload: string,
    extendedPayloadForSubmit?: ExtendedSubmitPayload,
  ): Promise<Response> {
    try {
      const { type, ...requestPayload } = JSON.parse(payload) as BaseSubmitPayload & {
        type: string;
      };

      let finalPayload = this.extendSubmitPayload(requestPayload, extendedPayloadForSubmit);
      finalPayload.engine5 = true;

      return await this.post(`upload-${type}`, finalPayload);
    } catch (error: unknown) {
      let errorMessage = error instanceof Error ? error.message : JSON.stringify(error);

      throw new SdkError(ErrorCode.NetworkError, `Failed to submit: ${errorMessage}`);
    }
  }

  private extendSubmitPayload(
    base: BaseSubmitPayload,
    extension?: ExtendedSubmitPayload,
  ): (BaseSubmitPayload & ExtendedSubmitPayload) | BaseSubmitPayload {
    if (extension) {
      const baseKeys = Object.keys(base) as (keyof BaseSubmitPayload)[];
      const extensionKeys = Object.keys(extension);
      const conflicts = extensionKeys.filter(
        key => baseKeys.indexOf(key as keyof BaseSubmitPayload) !== -1,
      );
      if (conflicts.length > 0) {
        throw new Error(
          `Extension cannot override base payload properties: ${conflicts.join(', ')}`,
        );
      }
    }

    return { ...base, ...extension };
  }

  /**
   * Make HTTP POST request to finalise the session.
   */
  public async complete(): Promise<void> {
    return new Promise(async (resolve, reject) => {
      try {
        await this.post(`finalise`);
        resolve();
      } catch (error) {
        reject(new SdkError(ErrorCode.NetworkError, 'Failed to submit: ' + JSON.stringify(error)));
      }
    });
  }

  /**
   * Make HTTP POST request
   * @param endpoint API Endpoint
   * @param body Request body
   * @returns Server response.
   */
  private async post(endpoint: string, body: object = {}): Promise<Response> {
    return new Promise(async (resolve, reject) => {
      try {
        // Make HTTP POST request to session API
        const response = await fetch(`${this.apiBaseUrl}/${endpoint}`, {
          method: 'POST',
          mode: 'cors',
          cache: 'no-cache',
          headers: {
            'Content-Type': 'application/json',
            'Transaction-Token': this.token,
          },
          body: JSON.stringify(body),
        });

        // Check if request was successful
        if (!response.ok) {
          return reject(
            new SdkError(ErrorCode.NetworkError, 'Failed to make request to session api.'),
          );
        }

        // Verify the response status.
        if (response.status === 200) {
          resolve(response);
          return;
        }

        reject(new SdkError(ErrorCode.InternalError));
      } catch (error) {
        return reject(new SdkError(ErrorCode.NetworkError, 'Error: ' + JSON.stringify(error))); // Reject with network error
      }
    });
  }
}
