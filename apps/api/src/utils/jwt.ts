import { sign, verify } from "jsonwebtoken";
import { getRuntimeConfig } from "../configs/runtime-config";

type JwtPayload = {
  id: string;
  email: string;
  exp: number;
};

const getSecret = () => getRuntimeConfig().jwtSecret;

export const signJwt = (payload: JwtPayload) =>
  sign(payload, getSecret(), {
    algorithm: "HS256",
    noTimestamp: true,
  });

export const verifyJwt = (token: string) => {
  try {
    const payload = verify(token, getSecret(), {
      algorithms: ["HS256"],
    }) as JwtPayload;
    if (!payload.id || !payload.email || !payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
};
