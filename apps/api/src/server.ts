import { createApp } from "./app.js";
import { createPool } from "./db.js";

const db = createPool();
const app = createApp({ db, logger: true });
app.addHook("onClose", async () => { await db.end(); });
await app.listen({ host: "0.0.0.0", port: Number(process.env.PORT ?? 8080) });
