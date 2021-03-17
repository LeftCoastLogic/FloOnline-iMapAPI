'use strict';
const { parentPort } = require('worker_threads');
const { Connection } = require('../lib/connection');
const { Account } = require('../lib/account');
const logger = require('../lib/logger');
const { redis, notifyQueue } = require('../lib/db');
const { MessagePortWritable } = require('../lib/message-port-stream');
const settings = require('../lib/settings');
const msgpack = require('msgpack5')();

const DEFAULT_STATES = {
    init: 0,
    connected: 0,
    connecting: 0,
    authenticationError: 0,
    connectError: 0,
    unset: 0,
    disconnected: 0
};

class ConnectionHandler {
    constructor() {
        this.callQueue = new Map();
        this.mids = 0;

        this.accounts = new Map();
    }

    async init() {
        // indicate that we are ready to process connections
        parentPort.postMessage({ cmd: 'ready' });
    }

    getLogKey(account) {
        // this format ensures that the key is deleted when user is removed
        return `iam:${account}:g`;
    }

    async getAccountLogger(account) {
        let logKey = this.getLogKey(account);
        let logging = await settings.getLoggingInfo(account);

        return {
            enabled: logging.enabled,
            maxLogLines: logging.maxLogLines,
            log(entry) {
                if (!this.maxLogLines || !this.enabled) {
                    return;
                }

                let logRow = msgpack.encode(entry);
                redis
                    .multi()
                    .rpush(logKey, logRow)
                    .ltrim(logKey, -this.maxLogLines, -1)
                    .exec()
                    .catch(err => this.logger.error(err));
            }
        };
    }

    async assignConnection(account) {
        logger.info({ msg: 'Assigned account to worker', account });
        let accountObject = new Account({ redis, account });

        this.accounts.set(account, accountObject);
        accountObject.connection = new Connection({
            account,
            accountObject,
            redis,
            notifyQueue,
            accountLogger: await this.getAccountLogger(account)
        });

        let accountData = await accountObject.loadAccountData();

        if (accountData.state === 'connected') {
            await redis.hmset(accountObject.connection.getAccountKey(), {
                state: 'connecting'
            });
        }

        // do not wait before returning as it may take forever
        accountObject.connection.init().catch(err => {
            logger.error({ account, err });
        });
    }

    async deleteConnection(account) {
        logger.info({ msg: 'Deleting connection', account });
        if (this.accounts.has(account)) {
            let accountObject = this.accounts.get(account);
            if (accountObject.connection) {
                await accountObject.connection.delete();
            }
            this.accounts.delete(account);
        }
    }

    async updateConnection(account) {
        logger.info({ msg: 'Account reconnect requested', account });
        if (this.accounts.has(account)) {
            let accountObject = this.accounts.get(account);
            if (accountObject.connection) {
                accountObject.connection.accountLogger.log({
                    level: 'info',
                    t: Date.now(),
                    cid: accountObject.connection.cid,
                    msg: 'Account reconnect requested'
                });
                await redis.hmset(accountObject.connection.getAccountKey(), {
                    state: 'connecting'
                });
                await accountObject.connection.reconnect(true);
            }
        }
    }

    async listMessages(message) {
        if (!this.accounts.has(message.account)) {
            return {
                error: 'No active handler for requested account. Try again later.'
            };
        }

        let accountData = this.accounts.get(message.account);
        if (!accountData.connection) {
            return {
                error: 'No active handler for requested account. Try again later.'
            };
        }

        return await accountData.connection.listMessages(message);
    }

    async messagePreviews(message) {
        if (!this.accounts.has(message.account)) {
            return {
                error: 'No active handler for requested account. Try again later.'
            };
        }

        let accountData = this.accounts.get(message.account);
        if (!accountData.connection) {
            return {
                error: 'No active handler for requested account. Try again later.'
            };
        }

        return await accountData.connection.messagePreviews(message);
    }

    async buildContacts(message) {
        if (!this.accounts.has(message.account)) {
            return {
                error: 'No active handler for requested account. Try again later.'
            };
        }

        let accountData = this.accounts.get(message.account);
        if (!accountData.connection) {
            return {
                error: 'No active handler for requested account. Try again later.'
            };
        }

        return await accountData.connection.buildContacts(message);
    }

    async getText(message) {
        if (!this.accounts.has(message.account)) {
            return {
                error: 'No active handler for requested account. Try again later.'
            };
        }

        let accountData = this.accounts.get(message.account);
        if (!accountData.connection) {
            return {
                error: 'No active handler for requested account. Try again later.'
            };
        }

        return await accountData.connection.getText(message.text, message.options);
    }

    async getMessage(message) {
        if (!this.accounts.has(message.account)) {
            return {
                error: 'No active handler for requested account. Try again later.'
            };
        }

        let accountData = this.accounts.get(message.account);
        if (!accountData.connection) {
            return {
                error: 'No active handler for requested account. Try again later.'
            };
        }

        return await accountData.connection.getMessage(message.message, message.options);
    }

    async updateMessage(message) {
        if (!this.accounts.has(message.account)) {
            return {
                error: 'No active handler for requested account. Try again later.'
            };
        }

        let accountData = this.accounts.get(message.account);
        if (!accountData.connection) {
            return {
                error: 'No active handler for requested account. Try again later.'
            };
        }

        return await accountData.connection.updateMessage(message.message, message.updates);
    }

    async moveMessage(message) {
        if (!this.accounts.has(message.account)) {
            return {
                error: 'No active handler for requested account. Try again later.'
            };
        }

        let accountData = this.accounts.get(message.account);
        if (!accountData.connection) {
            return {
                error: 'No active handler for requested account. Try again later.'
            };
        }

        return await accountData.connection.moveMessage(message.message, message.target);
    }

    async deleteMessage(message) {
        if (!this.accounts.has(message.account)) {
            return {
                error: 'No active handler for requested account. Try again later.'
            };
        }

        let accountData = this.accounts.get(message.account);
        if (!accountData.connection) {
            return {
                error: 'No active handler for requested account. Try again later.'
            };
        }

        return await accountData.connection.deleteMessage(message.message);
    }

    async submitMessage(message) {
        if (!this.accounts.has(message.account)) {
            return {
                error: 'No active handler for requested account. Try again later.'
            };
        }

        let accountData = this.accounts.get(message.account);
        if (!accountData.connection) {
            return {
                error: 'No active handler for requested account. Try again later.'
            };
        }

        return await accountData.connection.submitMessage(message.data);
    }

    async uploadMessage(message) {
        if (!this.accounts.has(message.account)) {
            return {
                error: 'No active handler for requested account. Try again later.'
            };
        }

        let accountData = this.accounts.get(message.account);
        if (!accountData.connection) {
            return {
                error: 'No active handler for requested account. Try again later.'
            };
        }

        return await accountData.connection.uploadMessage(message.data);
    }

    async createMailbox(message) {
        if (!this.accounts.has(message.account)) {
            return {
                error: 'No active handler for requested account. Try again later.'
            };
        }

        let accountData = this.accounts.get(message.account);
        if (!accountData.connection) {
            return {
                error: 'No active handler for requested account. Try again later.'
            };
        }

        return await accountData.connection.createMailbox(message.path);
    }

    async deleteMailbox(message) {
        if (!this.accounts.has(message.account)) {
            return {
                error: 'No active handler for requested account. Try again later.'
            };
        }

        let accountData = this.accounts.get(message.account);
        if (!accountData.connection) {
            return {
                error: 'No active handler for requested account. Try again later.'
            };
        }
        return await accountData.connection.deleteMailbox(message.path);
    }

    async getRawMessage(message) {
        if (!this.accounts.has(message.account)) {
            return {
                error: 'No active handler for requested account. Try again later.'
            };
        }

        let accountData = this.accounts.get(message.account);
        if (!accountData.connection) {
            return {
                error: 'No active handler for requested account. Try again later.'
            };
        }
        let stream = new MessagePortWritable(message.port);

        let source = await accountData.connection.getRawMessage(message.message);
        if (!source) {
            let err = new Error('Requested file not found');
            err.statusCode = 404;
            throw err;
        }

        setImmediate(() => {
            source.pipe(stream);
        });

        return {
            headers: source.headers,
            contentType: source.contentType
        };
    }

    async getAttachment(message) {
        if (!this.accounts.has(message.account)) {
            return {
                error: 'No active handler for requested account. Try again later.'
            };
        }

        let accountData = this.accounts.get(message.account);
        if (!accountData.connection) {
            return {
                error: 'No active handler for requested account. Try again later.'
            };
        }

        let stream = new MessagePortWritable(message.port);

        let source = await accountData.connection.getAttachment(message.attachment);
        if (!source) {
            let err = new Error('Requested file not found');
            err.statusCode = 404;
            throw err;
        }

        setImmediate(() => {
            source.pipe(stream);
        });

        return {
            headers: source.headers,
            contentType: source.contentType
        };
    }

    async kill() {
        if (this.killed) {
            return;
        }
        logger.error({ msg: 'Terminating process' });
        this.killed = true;

        this.accounts.forEach(account => {
            if (account.connection) {
                account.connection.close();
            }
        });

        process.exit(0);
    }

    // some general message
    async onMessage(message) {
        /*
        let dataview = new DataView(message);
        dataview.setUint8(Number(threadId), Number(threadId));
        */

        switch (message.cmd) {
            case 'settings':
                if (message.data && message.data.logs) {
                    for (let [account, accountObject] of this.accounts) {
                        // update log handling
                        let logging = await settings.getLoggingInfo(account, message.data.logs);
                        if (accountObject.connection) {
                            accountObject.connection.accountLogger.maxLogLines = logging.maxLogLines;
                            accountObject.connection.accountLogger.enabled = logging.enabled;
                            accountObject.connection.emitLogs = logging.enabled;
                            if (accountObject.connection.imapClient) {
                                accountObject.connection.imapClient.emitLogs = logging.enabled;
                            }
                        }
                        if (!logging.enabled) {
                            await redis.del(this.getLogKey(account));
                        }
                    }
                }
                return;
        }

        logger.debug({ msg: 'Unhandled message', message });
    }

    // message that expects a response
    async onCommand(message) {
        if (message && !['countConnections'].includes(message.cmd)) {
            logger.info(message);
        }

        switch (message.cmd) {
            case 'assign':
                return await this.assignConnection(message.account);

            case 'delete':
                return await this.deleteConnection(message.account);

            case 'update':
                return await this.updateConnection(message.account);

            case 'listMessages':
                return await this.listMessages(message);

            case 'buildContacts':
                return await this.buildContacts(message);

            case 'getText':
                return await this.getText(message);

            case 'getMessage':
                return await this.getMessage(message);

            case 'updateMessage':
                return await this.updateMessage(message);

            case 'moveMessage':
                return await this.moveMessage(message);

            case 'deleteMessage':
                return await this.deleteMessage(message);

            case 'getRawMessage':
                return await this.getRawMessage(message);

            case 'createMailbox':
                return await this.createMailbox(message);

            case 'deleteMailbox':
                return await this.deleteMailbox(message);

            case 'getAttachment':
                return await this.getAttachment(message);

            case 'submitMessage':
                return await this.submitMessage(message);

            case 'uploadMessage':
                return await this.uploadMessage(message);

            case 'messagePreviews':
                return await this.messagePreviews(message);

            case 'countConnections': {
                let results = Object.assign({}, DEFAULT_STATES);

                let count = status => {
                    if (!results[status]) {
                        results[status] = 0;
                    }
                    results[status] += 1;
                };

                this.accounts.forEach(accountObject => {
                    let state;

                    if (!accountObject || !accountObject.connection) {
                        state = 'unassigned';
                    } else {
                        state = accountObject.connection.currentState();
                    }

                    return count(state);
                });

                return results;
            }

            default:
                return false;
        }
    }

    async call(message) {
        return new Promise((resolve, reject) => {
            let mid = `${Date.now()}:${++this.mids}`;

            let timer = setTimeout(() => {
                let err = new Error('Timeout waiting for command response');
                err.statusCode = 504;
                err.code = 'Timeout';
                reject(err);
            }, message.timeout || 10 * 1000);

            this.callQueue.set(mid, { resolve, reject, timer });
            parentPort.postMessage({
                cmd: 'call',
                mid,
                message
            });
        });
    }

    metrics(key, method, ...args) {
        parentPort.postMessage({
            cmd: 'metrics',
            key,
            method,
            args
        });
    }
}

let connectionHandler = new ConnectionHandler();

async function main() {
    logger.info({ msg: 'Started worker thread' });
    await connectionHandler.init();
}

parentPort.on('message', message => {
    if (message && message.cmd === 'resp' && message.mid && connectionHandler.callQueue.has(message.mid)) {
        let { resolve, reject, timer } = connectionHandler.callQueue.get(message.mid);
        clearTimeout(timer);
        connectionHandler.callQueue.delete(message.mid);
        if (message.error) {
            let err = new Error(message.error);
            if (message.code) {
                err.code = message.code;
            }
            if (message.statusCode) {
                err.statusCode = message.statusCode;
            }
            return reject(err);
        } else {
            return resolve(message.response);
        }
    }

    if (message && message.cmd === 'call' && message.mid) {
        return connectionHandler
            .onCommand(message.message)
            .then(response => {
                parentPort.postMessage({
                    cmd: 'resp',
                    mid: message.mid,
                    response
                });
            })
            .catch(err => {
                logger.error(Object.assign(message, { err }));
                parentPort.postMessage({
                    cmd: 'resp',
                    mid: message.mid,
                    error: err.message,
                    code: err.code,
                    statusCode: err.statusCode
                });
            });
    }

    connectionHandler.onMessage(message).catch(err => logger.error(err));
});

process.on('SIGTERM', () => {
    connectionHandler.kill().catch(err => {
        logger.error({ msg: 'Execution failed', err });
        process.exit(4);
    });
});

process.on('SIGINT', () => {
    connectionHandler.kill().catch(err => {
        logger.error({ msg: 'Execution failed', err });
        process.exit(5);
    });
});

main().catch(err => {
    logger.error({ msg: 'Execution failed', err });
    setImmediate(() => process.exit(6));
});
