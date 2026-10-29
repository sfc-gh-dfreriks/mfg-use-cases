import path from "node:path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(import.meta.dirname, "../../.env") });
import express from "express";
import cors from "cors";
import apiRouter from "./routes/api.js";
import askCortexRouter from "./routes/askCortex.js";
import sourcesRouter from "./routes/sources.js";
import optimizeRouter from "./routes/optimize.js";

const app = express();
const PORT = parseInt(process.env.PORT ?? "3013", 10);
app.use(cors());
app.use(express.json());
app.use(apiRouter);
app.use(askCortexRouter);
app.use(sourcesRouter);
app.use(optimizeRouter);
app.listen(PORT, () => {
  console.log(`Multi-ERP Spend server listening on http://localhost:${PORT}`);
});
