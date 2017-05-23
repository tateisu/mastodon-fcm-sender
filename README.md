# mastodon-fcm-sender

## API

### POST /register 

(parameters)
- instanceUrl : URL of Mastodon instance you want to listen. ex) https://mastodon.juggler.jp .
- tag : any String that can be used for management in your app. this is also used for a part of unique key of registrations.
- appId : ID and secret of the your app.
- appSecret : ID and secret of the your app.
- accessToken : The access token you get from Mastodon's oAuth API.
- deviceToken : The device token that is used to sending FCM

(notice)
Your app needs to call /register repeatly within 3 days to keep listening.

### POST /unregister

(parameters)
- instanceUrl : same of specified in /register.
- tag : same of specified in /register.
- appId : same of specified in /register.
- appSecret : secret of the your app.

(notice)
The unique key of listener registration is : instanceUrl + appId + tag.
If you want to certainly unregister registration, You have to make same these parameters.

