import express from 'express'
import axios from 'axios'
import bodyParser from 'body-parser'
import npmlog from 'npmlog'
import morgan from 'morgan'
import Sequelize from 'sequelize'
import Hjson from 'hjson'
import fs from 'fs'
import querystring from 'querystring'
import util from 'util'


const app = express()
const port = process.env.PORT || 4001

process.on('unhandledRejection', console.dir);

const callbackUrl = process.env.CALLBACK_URL;
if (!callbackUrl) {
    npmlog.log('error', "callbackUrl", "missing CALLBACK_URL in environment.");
    process.exit();
}

const sequelize = new Sequelize(
    process.env.DB_NAME,
    process.env.DB_USER,
    process.env.DB_PASS, {
        dialect: process.env.DB_DIALECT,
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        logging: npmlog.verbose
        //    storage: 'db/fcm-sender.sqlite'
    }
)

var appMap;
var instanceMap;
const loadSetting = () => {
    //
    var file = 'config/app_map.hjson';
    try {
        appMap = Hjson.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        npmlog.log('error', file, e)
        throw e
    }
    //
    file = 'config/instance_map.hjson';
    try {
        instanceMap = Hjson.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        npmlog.log('error', file, e)
        throw e
    }
}

try {
    loadSetting();
} catch (e) {
    npmlog.log('error', 'loadSetting', e.stack)
    process.exit();
}

process.on('SIGHUP', function () {
    console.log('SIGHUP received. loading setting..');
    try {
        loadSetting();
    } catch (e) {
        npmlog.log('error', 'loadSetting', e.stack)
    }
});

const checkAppId = (appId) => {
    if (!appId) {
        return 'missing app_id';
    }
    var appEntry = appMap[appId];
    if (!appEntry) {
        return 'missing app configuration for app: ' + appId
    }
    var serverKey = appEntry.serverKey;
    if (!serverKey) {
        return 'missing server key in app configuration : ' + appId
    }

    return null;
}


const getServerKey = (appId) => {
    if (appId) {
        var appEntry = appMap[appId];
        if (appEntry) {
            return appEntry.serverKey;
        }
    }
    return null;
}

const getInstanceEntry = (instanceUrl) => {
    var instanceEntry = instanceMap[instanceUrl];
    if (!instanceEntry) {
        instanceEntry = instanceMap['*'];
    }
    return instanceEntry;
}

const getAppSecret = (instanceEntry, appId) => {
    var apps = instanceEntry.apps;
    if (apps) {
        return apps[appId];
    }
    return null;
}

const checkInstanceUrl = (instanceUrl, appId) => {
    if (!instanceUrl) {
        return 'missing instance_url';
    }

    var instanceEntry = getInstanceEntry(instanceUrl);
    if (!instanceEntry) {
        return 'missing instance configuration for instance: ' + instanceUrl;
    }

    if (!instanceEntry.urlStreamingListenerRegister) {
        return 'missing urlStreamingListenerRegister configuration: ' + instanceUrl;
    }
    if (!instanceEntry.urlStreamingListenerUnregister) {
        return 'missing urlStreamingListenerUnregister configuration: ' + instanceUrl;
    }
    const apps = instanceEntry.apps;
    if (!apps) {
        return 'missing apps configuration: ' + instanceUrl;
    }
    const appSecret = apps[appId];
    if (!appSecret) {
        return 'missing appSecret for app=' + appId + ', instance=' + instanceUrl;
    }

    return null;
}

// ユーザが用意したカスタム設定からインスタンス設定を探す
const getInstanceEntryCustom = (userConfig, instanceUrl) => {
    var instanceEntry = userConfig[instanceUrl];
    if (!instanceEntry) {
        instanceEntry = userConfig['*'];
    }
    return instanceEntry;
}

// ユーザが用意したカスタム設定とインスタンスURLの指定に問題がないか検証する
const checkInstanceUrlCustom = (userConfig, instanceUrl) => {

    if (!instanceUrl) {
        return 'missing instance_url';
    }

    var instanceEntry = getInstanceEntryCustom(userConfig, instanceUrl);
    if (!instanceEntry) {
        return 'missing instance configuration for instance: ' + instanceUrl;
    }

    if (!instanceEntry.urlStreamingListenerRegister) {
        return 'missing urlStreamingListenerRegister configuration: ' + instanceUrl;
    }

    if (!instanceEntry.urlStreamingListenerUnregister) {
        return 'missing urlStreamingListenerUnregister configuration: ' + instanceUrl;
    }

    if (!instanceEntry.appId) {
        return 'missing appId configuration: ' + instanceUrl;
    }

    return null;
}

const Registration = sequelize.define('fcm_sender_registration', {

    lastUpdate: {
        type: Sequelize.BIGINT,
        defaultValue: 0
    },

    instanceUrl: {
        type: Sequelize.STRING
    },

    appId: {
        type: Sequelize.STRING
    },

    tag: {
        type: Sequelize.STRING
    },

    accessToken: {
        type: Sequelize.STRING
    },

    deviceToken: {
        type: Sequelize.STRING
    },

    userConfig: {
        type: Sequelize.TEXT
    },

    userSecret: {
        type: Sequelize.STRING
    },

    // ユーザ設定により与えられたアプリID。ListenerからコールバックされるときのアプリIDはこちらと照合する
    appIdUser: {
        type: Sequelize.STRING
    }

}, {
    indexes: [
        {
            name: 'fcm_sender_registrations_iat',
            unique: true,
            fields: ['instanceUrl', 'appId', 'tag']
        },
        {
            name: 'fcm_sender_registrations_iat2',
            unique: false,
            fields: ['instanceUrl', 'appIdUser', 'tag']
        }
    ]
})

const sendListenerRegister = (log, registration, url, appSecret) => {
    if (url && appSecret) {
        // streaming-listener に登録を出す
        axios.post(url, querystring.stringify({
            instance_url: registration.instanceUrl,
            tag: registration.tag,
            app_id: registration.appIdUser,
            app_secret: appSecret,
            access_token: registration.accessToken,
            callback_url: callbackUrl
        }), {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded"
            }
        }).then(response => {
            log('info', `listener returns ${response.status}: ${JSON.stringify(response.data)}`)
        }).catch(error => {
            log('error', "request to listener#register failed.");
            log('error', util.inspect(error));
        })
    }
}

const sendUnregisterListener = (log, registration, url, appSecret) => {
    if (url && appSecret) {
        // streaming-listener に登録解除を出す
        axios.post(url, querystring.stringify({
            instance_url: registration.instanceUrl,
            tag: registration.tag,
            app_id: registration.appIdUser,
            app_secret: appSecret
        }), {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded"
            }
        }).then(response => {
            log('info', `listener returns ${response.status}: ${JSON.stringify(response.data)}`)
        }).catch(error => {
            log('error', "request to listener#unregister failed.");
            log('error', util.inspect(error));
        })
    }
}


const connectForUser = (registration) => {

    const log_key = `${registration.instanceUrl}:${registration.appId}:${registration.tag}`;
    const log = (level, message) => npmlog.log(level, log_key, message)

    var userConfigStr = registration.userConfig;
    var userConfig = null
    if (userConfigStr) {
        try {
            userConfig = Hjson.parse(userConfig);
        } catch (e) {
            log('error', "user_config parse error: " + e);
        }
    }

    if (!userConfig) {
        const instanceEntry = getInstanceEntry(registration.instanceUrl);
        if (instanceEntry) {
            sendListenerRegister(
                log,
                registration,
                instanceEntry.urlStreamingListenerRegister,
                getAppSecret(instanceEntry, registration.appId)
            );
        }
    } else {
        const customEntry = getInstanceEntryCustom(userConfig, registration.instanceUrl);
        if (customEntry) {
            sendListenerRegister(
                log,
                registration,
                customEntry.urlStreamingListenerRegister,
                registration.userSecret
            );
        }
    }
}

const disconnectForUser = (registration) => {

    const log_key = `${registration.instanceUrl}:${registration.appId}:${registration.tag}`;
    const log = (level, message) => npmlog.log(level, log_key, message)

    var userConfigStr = registration.userConfig;
    var userConfig = null
    if (userConfigStr) {
        try {
            userConfig = Hjson.parse(userConfig);
        } catch (e) {
            log('error', "user_config parse error: " + e);
        }
    }

    if (!userConfig) {
        const instanceEntry = getInstanceEntry(registration.instanceUrl);
        if (instanceEntry) {
            sendUnregisterListener(
                log,
                registration,
                instanceEntry.urlStreamingListenerUnregister,
                getAppSecret(instanceEntry, registration.appId)
            );
        }

    } else {
        const customEntry = getInstanceEntryCustom(userConfig, registration.instanceUrl);
        if (customEntry) {
            sendUnregisterListener(
                log,
                registration,
                customEntry.urlStreamingListenerUnregister,
                registration.userSecret
            );
        }
    }
    registration.destroy();
    log('info', 'Registration destroyed.')
}

const sendFCM = (registration, payload_str) => {

    const log_key = `${registration.instanceUrl}:${registration.appId}:${registration.tag}`;
    const log = (level, message) => npmlog.log(level, log_key, message)

    var serverKey = getServerKey(registration.appId);
    if (!serverKey) {
        log('error', 'missing server key for app:' + registration.appId);
        disconnectForUser(registration);
        return;
    }

    log('info', 'payload length=' + payload_str.length);
    const payload_json = JSON.parse(payload_str);

    const firebaseMessage = {
        to: registration.deviceToken,
        priority: 'high',
        data: {
            notification_tag: registration.tag,
            // ペイロードそのものは大きすぎて送れない
            notification_id: payload_json.id
        }
    }

    axios.post(
        'https://fcm.googleapis.com/fcm/send',
        JSON.stringify(firebaseMessage), {
            headers: {
                'Authorization': `key=${serverKey}`,
                'Content-Type': 'application/json'
            }
        }
    ).then(response => {
        log('info', `Sent to FCM, status ${response.status}: ${JSON.stringify(response.data)}`)

        if (response.data.failure === 0 && response.data.canonical_ids === 0) {
            return
        }

        response.data.results.forEach(result => {
            if (result.message_id && result.registration_id) {
                // デバイストークンが更新された
                registration.update({
                    deviceToken: result.registration_id
                })
            } else if (result.error === 'NotRegistered') {
                disconnectForUser(registration);
            }
        })
    }).catch(error => {
        log('error', `Error sending to FCM, status: ${error.response.status}: ${JSON.stringify(error.response.data)}`)
    })
}


Registration.sync();

app.use(morgan('combined'));

app.get('/', (req, res) => {
    res.sendStatus(204)
})

app.use('/register', bodyParser.urlencoded({
    extended: true
}))

app.post('/register', (req, res) => {

    const log = (level, message) => npmlog.log(level, "register:", message)

    const now = (new Date()).getTime();

    var error;

    const appId = req.body.app_id;
    error = checkAppId(appId);
    if (error) {
        log('error', error);
        res.status(400).send(error);
        return;
    }

    var userConfigStr = req.body.user_config;

    var userConfig = null
    if (userConfigStr) {
        try {
            userConfig = Hjson.parse(userConfigStr);
        } catch (e) {
            log('error', "user_config parse error: " + e)
            res.status(400).send("user_config parse error: " + e);
            return;
        }
    }

    const instanceUrl = req.body.instance_url.toLowerCase();
    const accessToken = req.body.access_token;
    const deviceToken = req.body.device_token;
    const tag = req.body.tag;

    var userSecret;
    var appIdUser = appId;
    if (!userConfig) {
        error = checkInstanceUrl(instanceUrl, appId)
        if (error) {
            log('error', error);
            res.status(400).send(error);
            return;
        }
    } else {
        error = checkInstanceUrlCustom(userConfig, instanceUrl)
        if (error) {
            log('error', error);
            res.status(400).send(error);
            return;
        }
        const customEntry = getInstanceEntryCustom(userConfig, instanceUrl);
        if (!customEntry) {
            error = "missing configuration for instance: " + instanceUrl;
            log('error', error);
            res.status(400).send(error);
            return;
        }

        appIdUser = customEntry.appId;
        if (!appIdUser) {
            error = "missing appId for instance: " + instanceUrl;
            log('error', error);
            res.status(400).send(error);
            return;
        }

        userSecret = req.body.app_secret;
        if (!userSecret) {
            error = "missing app_secret";
            log('error', error);
            res.status(400).send(error);
            return;
        }

    }

    Registration.findOrCreate({
        where: {
            instanceUrl: instanceUrl,
            appId: appId,
            tag: tag
        }
    }).then(args => {
        const model = args[0];
        // const created = args[1];

        if (model) {
            model.update({
                lastUpdate: now,
                deviceToken: deviceToken,
                accessToken: accessToken,
                userConfig: userConfigStr,
                userSecret: userSecret,
                appIdUser: appIdUser
            }).then((ignored) => {
                connectForUser(model);
            });
        }
    }).catch(error => {
        log('error', error +":" +error.stack)
    })

    res.sendStatus(202)
})

app.use('/unregister', bodyParser.urlencoded({
    extended: true
}))

app.post('/unregister', (req, res) => {

    const log = (level, message) => npmlog.log(level, "unregister", message)

    const appId = req.body.app_id;
    const instanceUrl = req.body.instance_url.toLowerCase();
    const tag = req.body.tag;

    Registration.findOne({
        where: {
            instanceUrl: instanceUrl,
            appId: appId,
            tag: tag,
        }
    }).then((registration) => {
        if (registration) {
            disconnectForUser(registration)
        }
    }).catch(error => {
        log('error', error +":" +error.stack)
    })

    res.sendStatus(202)
})

app.use('/callback', bodyParser.json())

app.post('/callback', (req, res) => {

    const log = (level, message) => npmlog.log(level, "callback", message)

    var error;
    
    const payload = req.body.payload;
    if (!payload) {
        error = "missing payload.";
        log('error', error +" json=" + util.inspect(req.body) )
        res.status(400).send(error);
        return;
    }

    const appId = req.body.appId;
    const instanceUrl = req.body.instanceUrl;
    const tag = req.body.tag;

    Registration.findOne({
        where: {
            instanceUrl: instanceUrl,
            appId: appId,
            tag: tag,
        }
    }).then((registration) => {
        if (registration) {
            sendFCM(registration, payload)
        } else {
            Registration.findOne({
                where: {
                    instanceUrl: instanceUrl,
                    appIdUser: appId,
                    tag: tag,
                }
            }).then((registration) => {
                if (registration) {
                    sendFCM(registration, payload)
                } else {
                    log('info', `missing registration for ${instanceUrl},${appId},${tag}`)
                }
            });
        }
    }).catch(error => {
        log('error', error +":" +error.stack)
    })

    res.sendStatus(202)
})


app.get('/counter', (req, res) => {
    const log = (level, message) => npmlog.log(level, "counter", message)

    const file = 'config/counter.hjson';
    const file_tmp = file + ".tmp";
    var map;
    try {
        map = Hjson.parse(fs.readFileSync(file, 'utf8'))
    } catch (e) {
        log('error', e)
        map = {};
    }

    var count = map.count;
    if (!count) {
        count = 1;
    } else {
        ++count;
    }
    map.count = count;
    fs.writeFileSync(file_tmp, Hjson.stringify(map));
    fs.renameSync(file_tmp, file)

    res.status(200).send("" + count);
});


app.listen(port, () => {
    npmlog.log('info', `Listening on port ${port}`)
})