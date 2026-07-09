declare module 'jsonwebtoken' {
  export type SignOptions = {
    algorithm?: 'HS256';
    noTimestamp?: boolean;
  };

  export type VerifyOptions = {
    algorithms?: Array<'HS256'>;
  };

  export function sign(
    payload: string | Buffer | Record<string, unknown>,
    secretOrPrivateKey: string,
    options?: SignOptions,
  ): string;

  export function verify(
    token: string,
    secretOrPublicKey: string,
    options?: VerifyOptions,
  ): string | Record<string, unknown>;
}
