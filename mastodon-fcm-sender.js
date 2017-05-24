import express from 'express'
import axios from 'axios'
import bodyParser from 'body-parser'
import npmlog from 'npmlog'
import morgan from 'morgan'
import Sequelize from 'sequelize'
import Hjson from 'hjson'
import fs from 'fs'
import util from 'util'


const app       = express()
const port      = process.env.PORT || 4001

const callbackUrl = process.env.CALLBACK_URL;

const sequelize = new Sequelize('sqlite://fcm-sender.sqlite', {
  logging: npmlog.verbose,
    storage: 'db/fcm-sender.sqlite'
})

const appMap = Hjson.parse(fs.readFileSync('db/app_map.hjson', 'utf8'));

const instanceMap = Hjson.parse(fs.readFileSync('db/instance_map.hjson', 'utf8'));

const checkAppId = (appId ) => {
    if (!appId) {
        return 'missing app_id';
    }
    var appEntry = appMap[appId];
    if (!appEntry) {
        return 'missing app configuration for app: ' + appId
    }
    var serverKey = appEntry.serverKey;
    if(! serverKey ){
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

const getInstanceEntry = ( instanceUrl) =>{
    var instanceEntry = instanceMap[ instanceUrl ];
    if( ! instanceEntry ){
        instanceEntry = instanceMap[ '*' ];
    }
    return instanceEntry;
}

const getAppSecret = (instanceEntry,appId) =>{
    var apps = instanceEntry.apps;
    if( apps ){
        return apps[ appId ];
    }
    return null;
}

const checkInstanceUrl = (instanceUrl,appId) =>{
    if( ! instanceUrl ){
        return 'missing instance_url';
    }
    
    var instanceEntry = getInstanceEntry(instanceUrl);
    if( ! instanceEntry ){
        return 'missing instance configuration for instance: ' + instanceUrl ;
    }
    
    if(! instanceEntry.urlStreamingListenerRegister ){
        return 'missing urlStreamingListenerRegister configuration: ' + instanceUrl ;
    }
    if(! instanceEntry.urlStreamingListenerUnregister ){
        return 'missing urlStreamingListenerUnregister configuration: ' + instanceUrl ;
    }
    const apps = instanceEntry.apps;
    if(!apps){
        return 'missing apps configuration: ' + instanceUrl ;
    }
    const appSecret = apps[ appId ];
    if(!appSecret){
        return 'missing appSecret for app=' + appId + ', instance='+ instanceUrl ;
    }
    
    return null;
}


const Registration = sequelize.define('registration', {

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
    }

})

const connectForUser = (registration) => {

    const ws_key = `${registration.instanceUrl}:${registration.app_id}:${registration.tag}`;
    const log = (level, message) => npmlog.log(level, ws_key, message)

    const instanceEntry =  getInstanceEntry( registration.instanceUrl);
    if(instanceEntry){
        const urlStreamingListenerRegister = instanceEntry.urlStreamingListenerRegister;
        const appSecret = getAppSecret( instanceEntry,  registration.appId )
        if( urlStreamingListenerRegister && appSecret ){
            // streaming-listener に登録を出す
            axios.post( urlStreamingListenerRegister, {
                instance_url: registration.instanceUrl,
                tag: registration.tag,
                app_id: registration.appId,
                app_secret: appSecret,
                access_token: registration.accessToken,
                callback_url: callbackUrl
            }).then(response => {
                log('info', `register: status ${response.status}: ${JSON.stringify(response.data)}`)
            }).catch(error => {
                log('error', `Error sending to register, status: ${error.response.status}: ${JSON.stringify(error.response.data)}`)
            })
        }
    }
}
 

const disconnectForUser = (registration) => {

    const ws_key = `${registration.instanceUrl}:${registration.app_id}:${registration.tag}`;
    const log = (level, message) => npmlog.log(level, ws_key, message)
    
    const instanceEntry =  getInstanceEntry( registration.instanceUrl);
    if(instanceEntry){
        const urlStreamingListenerUnregister = instanceEntry.urlStreamingListenerUnregister;
        const appSecret = getAppSecret( instanceEntry,  registration.appId )
        if( urlStreamingListenerUnregister && appSecret ){
            // streaming-listener に登録解除を出す
            axios.post( urlStreamingListenerUnregister, {
                instance_url: registration.instanceUrl,
                tag: registration.tag,
                app_id: registration.appId,
                app_secret: appSecret
            }).then(response => {
                log('info', `unregister: status ${response.status}: ${JSON.stringify(response.data)}`)
            }).catch(error => {
                log('error', `Error sending to unregister, status: ${error.response.status}: ${JSON.stringify(error.response.data)}`)
            })
        }
    }
    
	registration.destroy();
	log('info', 'Registration destroyed.')
}

const sendFCM = (registration,payload) => {

    const ws_key = `${registration.instanceUrl}:${registration.app_id}:${registration.tag}`;
    const log = (level, message) => npmlog.log(level, ws_key, message)

    var serverKey = getServerKey(registration.appId);
    if( ! serverKey ){
        log('error','missing server key for app:' +registration.appId);
        disconnectForUser( registration);
        return;
    }

    const firebaseMessage = {
        to: registration.deviceToken,
        priority: 'high',
        data: { notification_id: payload.id }
    }

    axios.post(
        'https://fcm.googleapis.com/fcm/send',
        JSON.stringify(firebaseMessage),
        {
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

        response.data.results.forEach( result => {
            if (result.message_id && result.registration_id ){
                // デバイストークンが更新された
                registration.update({ deviceToken: result.registration_id }	)
            } else if ( result.error === 'NotRegistered' ){
                disconnectForUser( registration);
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

app.use('/register',bodyParser.urlencoded({ extended: true }))

app.post('/register', (req, res) => {

	const now = (new Date()).getTime();

    var error;

    const appId = req.body.app_id;
    error = checkAppId(appId);
    if( error ){
        res.send(400,error);
        return;
    }
    
    const instanceUrl = req.body.instance_url.toLowerCase();
    error = checkInstanceUrl( instanceUrl , appId)
    if( error ){
        res.send(400,error);
        return;
    }
    
    const accessToken = req.body.access_token;
    const deviceToken = req.body.device_token;
    const tag = req.body.tag;
    
    const options = {
        where: {
            instanceUrl: instanceUrl,
            appId: appId,
            tag:tag
        }
    };
    
    Registration
        .findOrCreate(options)
        .then( (model,created) => {

        if (model ) {
            npmlog.log('info',"register: " +model)
            npmlog.log('info',"register: " +util.inspect(model) )
            npmlog.log('info',"register: " +model.set)
            npmlog.log('info',"register: " +model.save)

            model.update({
				lastUpdate: now,
                deviceToken:deviceToken,
                accessToken:accessToken,
            } ).then( (ignored)=>{
                // stream listener への接続を行う
                connectForUser( model );
            });
		}
        
	})

	res.sendStatus(201)
})

app.use('/unregister',bodyParser.urlencoded({ extended: true }))

app.post('/unregister', (req, res) => {

    var error;

    const appId = req.body.app_id;
    error = checkAppId(appId);
    if( error ){
        res.send(400,error);
        return;
    }

    const instanceUrl = req.body.instance_url.toLowerCase();
    error = checkInstanceUrl( instanceUrl , appId)
    if( error ){
        res.send(400,error);
        return;
    }

    const tag = req.body.tag;

	Registration.findOne({
		where: {
            instanceUrl:instanceUrl,
            appId: appId,
            tag: tag,
		}
	}).then( (registration) => {
		if (registration ) {
            npmlog.log('info',"unregister: " +registration)
            disconnectForUser(registration)
		}
	})

	res.sendStatus(201)
})

app.use('/callback',bodyParser.json())

app.post('/callback', (req, res) => {

    var error;
    
    var json = req.body;
    

    const appId = json.appId;
    error = checkAppId(appId);
    if( error ){
        res.send(400,error);
        return;
    }

    const instanceUrl = json.instanceUrl;
    error = checkInstanceUrl( instanceUrl , appId)
    if( error ){
        res.send(400,error);
        return;
    }

    const tag = tag;

    Registration.findOne({
        where: {
            instanceUrl:instanceUrl,
            appId: appId,
            tag: tag,
        }
    }).then( (registration) => {
        if (registration ) {
            npmlog.log('info',"callback: " +registration)

            sendFCM( registration, Hjson.parse(json.payload) )
        }
    })

    res.sendStatus(201)
})


app.get('/counter',(req, res) => {
    const log = (level, message) => npmlog.log(level, "counter", message)

    const file = 'db/counter.hjson';
    const file_tmp = file +".tmp";
    var map;
    try{
        map = Hjson.parse( fs.readFileSync(file, 'utf8'))
    }catch(e){
        log('error',e)
        map = {};
    }

    var count = map.count;
    if(!count){
        count = 1;
    }else{
        ++count;
    }
    map.count = count;
    fs.writeFileSync(file_tmp, Hjson.stringify(map) );
    fs.renameSync( file_tmp,file)
    
    res.send( 200,count);
});
    

app.listen(port, () => {
  npmlog.log('info', `Listening on port ${port}`)
})
