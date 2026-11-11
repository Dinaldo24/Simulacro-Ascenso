import "reflect-metadata";
import { DataSource } from "typeorm";
import { env } from "../config/env";
import { ENTITIES } from "./entities";

export const AppDataSource = new DataSource({
    type: "mysql",
    host: env.db.host,
    port: env.db.port,
    username: env.db.user,
    password: env.db.password,
    database: env.db.name,
    charset: "utf8mb4",
    poolSize: env.db.poolSize,
    connectTimeout: 10000,
    extra: {
        waitForConnections: true,
        queueLimit: 0,
    },
    synchronize: env.db.synchronize,
    logging: env.db.logging,
    entities: ENTITIES,
    migrations: [],
    subscribers: [],
});

export async function initializeDatabase(): Promise<void> {
    if (!AppDataSource.isInitialized) {
        await AppDataSource.initialize();
    }
}

export async function checkDatabaseHealth(): Promise<boolean> {
    if (!AppDataSource.isInitialized) {
        return false;
    }
    try {
        await AppDataSource.query("SELECT 1");
        return true;
    } catch {
        return false;
    }
}

export async function closeDatabase(): Promise<void> {
    if (AppDataSource.isInitialized) {
        await AppDataSource.destroy();
    }
}
