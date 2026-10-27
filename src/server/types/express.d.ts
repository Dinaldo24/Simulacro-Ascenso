import type { AuthenticatedUser } from "../auth-routes.js";

declare module "express-session" {
    interface SessionData {
        userId?: number;
    }
}

declare global {
    namespace Express {
        interface Request {
            currentUser?: AuthenticatedUser;
        }
    }
}
