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

const pythonInterpreter = "/home/ubuntu/dillamme-scheduler/backend/.venv/bin/python";
const backendDir = "/home/ubuntu/dillamme-scheduler/backend";

module.exports = {
  apps: [
    {
      name: "dillame-api",
      script: pythonInterpreter,
      args: "-m uvicorn main:app --host 0.0.0.0 --port 8000",
      cwd: backendDir,
      env: {
        PYTHONUNBUFFERED: "1",
      },
      watch: false,
      max_restarts: 10,
      restart_delay: 5000,
      error_file: "logs/pm2-api-error.log",
      out_file: "logs/pm2-api-out.log",
    },

    {
      name: "dillame-worker",
      script: pythonInterpreter,
      args: "worker.py",
      cwd: backendDir,
      env: {
        PYTHONUNBUFFERED: "1",
        WORKER_ID: "worker-01",
      },
      watch: false,
      max_restarts: 10,
      restart_delay: 5000,
      error_file: "logs/pm2-worker-error.log",
      out_file: "logs/pm2-worker-out.log",
    },
  ],
};