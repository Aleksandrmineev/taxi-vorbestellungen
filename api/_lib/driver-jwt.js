import { signJwt } from "./jwt.js";

export const DRIVER_JWT_TTL_SEC = 365 * 24 * 60 * 60;

export function issueDriverJwt(driver) {
  return signJwt(
    { sub: String(driver.id), tn: String(driver.taxiNumber || ""), name: driver.name || "", surname: driver.surname || "" },
    DRIVER_JWT_TTL_SEC
  );
}
