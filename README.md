# mastodon-fcm-sender

simple server to relay notifications from mastodon-streaming-listener to Firebase Cloud Messaging

## API

### POST /register 

(parameters)
- instance_url : URL of Mastodon instance you want to listen. ex) https://mastodon.juggler.jp . max length is 255 byte.
- tag : any String that can be used for management in your app. this is also used for a part of unique key of registrations. max length is 255 byte.
- app_id : ID and secret of the your app. max length is 255 byte.
- access_token : The access token you get from Mastodon's oAuth API.
- device_token : The device token that is used to sending FCM

(notice)
Your app needs to call /register repeatly within 3 days to keep listening.

### POST /unregister

(parameters)
- instance_url : same of specified in /register.
- tag : same of specified in /register.
- app_id : same of specified in /register.

(notice)
The unique key of listener registration is : instanceUrl + appId + tag.
If you want to certainly unregister registration, You have to make same these parameters.

### POST /callback

see 'Callback' section in https://github.com/tateisu/mastodon-streaming-listener .

## installation (using docker-compose)

### prepare database 
Please make a database for this app. and memo the parameters that required to connect from app to database.

```
# type of db. One of mysql, postgres, mssql. (Don't use sqlite)
DB_DIALECT=postgres

# host name or IP addres of database server
DB_HOST=172.17.0.1

# port number of database server
DB_PORT=4003

# name of database
DB_NAME=fcm_sender

# login information
DB_USER=fcm_sender
DB_PASS=***
```

after git clone , you have to change some file.

```
# copy sample configuration files
cp config/app_map.hjson.sample config/app_map.hjson
cp config/instance_map.hjson.sample config/instance_map.hjson

(edit these .hjson files to configure for client app and instances)

# copy sample .env.production files
cp .env.production.sample .env.production

(edit this file to configure database connection, callback url )

# make directory writable for a counter.
chown 1001:1001 config
```

### build and start 

```
docker-compose build

docker-compose up
```

### configure nginx

This app listens on port 4001 at default.
You can configure exposed port in docker-compose.yml.
You should use Web frontend (nginx) to wrap with HTTPS.


# Tweak 

### create index

`create unique index fcm_sender_registrations_iat on fcm_sender_registrations ( "instanceUrl","appId","tag" );`
