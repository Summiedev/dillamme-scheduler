/**
 * PM2 Ecosystem Configuration for Dilamme Scheduler.
 *
 * Two processes:
 *  - api: FastAPI + Uvicorn
 *  - worker: Standalone worker process
 *
 * Usage:
 *   pm2 start ecosystem.config.js
 *   pm2 logs
 *   pm2 stop ecosystem.config.js
 */

const path = require("path");

const pythonInterpreter = path.join(
  __dirname,
  "backend",
  ".venv",
  "Scripts",
  "python.exe"
);

module.exports = {
  apps: [
    {
      name: "dillame-api",
      script: "uvicorn",
      args: "main:app --host 0.0.0.0 --port 8000 --reload",
      interpreter: pythonInterpreter,
      cwd: __dirname,
      env: {
        PYTHONUNBUFFERED: "1",
      },
      watch: false,
      max_restarts: 10,
      restart_delay: 5000,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file: "logs/pm2-api-error.log",
      out_file: "logs/pm2-api-out.log",
      merge_logs: true,
    },
    {
      name: "dillame-worker",
      script: "worker.py",
      interpreter: pythonInterpreter,
      cwd: __dirname,
      env: {
        PYTHONUNBUFFERED: "1",
        WORKER_ID: "worker-01",
      },
      watch: false,
      max_restarts: 10,
      restart_delay: 5000,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file: "logs/pm2-worker-error.log",
      out_file: "logs/pm2-worker-out.log",
      merge_logs: true,
    },
  ],
};
