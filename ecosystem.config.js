module.exports = {
  apps: [{
    name: 'iiko-shift-bot',
    script: 'src/index.js',
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    env: {
      NODE_ENV: 'production'
    },
    error_file: 'logs/error.log',
    out_file: 'logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    restart_delay: 4000,
    max_restarts: 10
  }]
};
