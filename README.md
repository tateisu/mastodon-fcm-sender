# mastodon-fcm-sender (not work yet)

simple server to relay notifications from mastodon-streaming-listener to Firebase Cloud Messaging

## API

### POST /register 

(parameters)
- instance_url : URL of Mastodon instance you want to listen. ex) https://mastodon.juggler.jp .
- tag : any String that can be used for management in your app. this is also used for a part of unique key of registrations.
- app_id : ID and secret of the your app.
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

after git clone , you have to change some file.

```
# copy sample configuration files
cp db/app_map.hjson.sample db/app_map.hjson
cp db/instance_map.hjson.sample db/instance_map.hjson

(edit these .hjson files to configure for client app and instances)

# copy sample .env.production files
cp .env.production.sample .env.production

(edit this file to configure configuration)


# create new database file if not exists
sqlite db/fcm-sender.sqlite 'select 1;'

# make database file that readable from 'app1' user in container
chown -R 1001:1001 db

# edit docker-compose.yml

docker-compose build

docker-compose up
```

default port is 4001. you can configure exposed port in docker-compose.yml.
You should make web frontend (nginx) to wrap with HTTPS.
