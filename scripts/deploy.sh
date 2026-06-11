#!/bin/bash
set -e
cd /home/ubuntu/dillame-scheduler
git pull
cd backend
uv sync --frozen
cd ../frontend
npm run build
sudo cp -r dist/* /var/www/dilamme/frontend/
cd ..
pm2 restart ecosystem.config.js
