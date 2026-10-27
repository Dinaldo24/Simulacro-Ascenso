declare module "express-mysql-session" {
    import type { Pool } from "mysql2/promise";
    import type { Store } from "express-session";

    interface MySQLSessionStoreOptions {
        clearExpired: boolean;
        checkExpirationInterval: number;
        expiration: number;
        createDatabaseTable: boolean;
    }

    class MySQLSessionStore extends Store {
        constructor(options: MySQLSessionStoreOptions, pool: Pool);
        on(event: "error", listener: (error: Error) => void): this;
        onReady(): Promise<void>;
    }

    function createMySQLSessionStore(
        session: typeof import("express-session")
    ): typeof MySQLSessionStore;

    export = createMySQLSessionStore;
}
