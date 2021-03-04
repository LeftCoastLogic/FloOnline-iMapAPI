'use strict';

const config = require('wild-config');
const pino = require('pino');

const { getConfig } = require('../config/config');
const appConfig = getConfig();

config.log = config.log || {
    level: 'trace'
};

let logger = pino();
logger.level = appConfig.LOG_LEVEL || process.env.LOG_LEVEL || config.log.level;

const { threadId } = require('worker_threads');

if (threadId) {
    logger = logger.child({ tid: threadId });
}

process.on('uncaughtException', err => {
    logger.fatal({
        msg: 'uncaughtException',
        err
    });
    setTimeout(() => process.exit(1), 10);
});

process.on('unhandledRejection', err => {
    logger.fatal({
        msg: 'unhandledRejection',
        err
    });
    setTimeout(() => process.exit(2), 10);
});

module.exports = logger;
