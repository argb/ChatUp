"use strict";
var _ = require('lodash');
var jwt = require('jsonwebtoken');
var logger = require('../../common/logger');
var debug = require('debug')('ChatUp:Dispatcher:BanHandler');
function banHandler(parent) {
    var handler = function (req, res) {
        if (!_.isString(req.body)) {
            logger.captureError(logger.error('Wrong post message JWT'));
            return res.sendStatus(400);
        }
        jwt.verify(req.body, parent._conf.jwt.key, parent._conf.jwt.options, function (err, decoded) {
            if (err) {
                logger.captureError(err);
                debug('Authentication error: Wrong JWT', req.body, err);
                return res.status(401).send({ status: 'error', err: "Wrong JWT" });
            }
            function wrongJWTContent() {
                logger.captureError(new Error('Ban: Wrong JWT content'));
                debug('Authentication error: Wrong JWT content', req.body, decoded);
                return res.status(400).send({ status: 'error', err: "Wrong JWT content" });
            }
            if (!_.isArray(decoded)) {
                wrongJWTContent();
            }
            var toBans = [];
            for (var i = 0; i < decoded.length; i++) {
                var toBan = {};
                if (!_.isString(decoded[i].name) || !_.isString(decoded[i].channel)) {
                    return wrongJWTContent();
                }
                toBan.name = decoded[i].name;
                toBan.channel = decoded[i].channel;
                if (_.isNumber(decoded[i].expire)) {
                    toBan.expire = decoded[i].expire;
                }
                toBans.push(toBan);
            }
            var redisMulti = parent._redisConnection.multi();
            for (var i = 0; i < toBans.length; i++) {
                var keyName = 'chatUp:ban:' + toBans[i].channel + ':' + toBans[i].name;
                redisMulti.set(keyName, 1);
                if (toBans[i].expire) {
                    redisMulti.expire(keyName, toBans[i].expire);
                }
                else {
                    redisMulti.persist(keyName);
                }
                var banNotif = JSON.stringify({
                    ev: "rmUserMsg",
                    data: toBans[i].name
                });
                redisMulti.publish('r_m_' + toBans[i].channel, banNotif);
                redisMulti.lpush('chatUp:room:r_m_' + toBans[i].channel, banNotif);
                redisMulti.ltrim('chatUp:room:r_m_' + toBans[i].channel, 0, parent._conf.messageHistory.size - 1);
                redisMulti.expire('chatUp:room:r_m_' + toBans[i].channel, parent._conf.messageHistory.expire);
                debug("Banning %s of channel %s", toBans[i].name, toBans[i].channel);
            }
            redisMulti.exec(function (err) {
                if (err) {
                    logger.captureError(err);
                    res.status(500).send(err);
                }
                res.sendStatus(200);
            });
        });
    };
    return handler;
}
exports.banHandler = banHandler;
