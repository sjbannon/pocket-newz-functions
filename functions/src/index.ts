import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { GetSignedUrlConfig } from '@google-cloud/storage';

admin.initializeApp();

const cors = require('cors')({ origin: true });

const storage = admin.storage();
const bucket = storage.bucket('mobile-ios-pocketnewz.appspot.com');

const db = admin.firestore();

export const setupNewUser = functions.auth.user().onCreate(async user => {
  const userRef =        db.collection('UserInfo').doc(user.uid);
  const stationsRef =    db.collection('Stations').doc(user.uid);
  const newzerStatsRef = db.collection('NewzerStats').doc(user.uid);
  try {
    const userSnapshot = await userRef.get();
    if (userSnapshot.exists) {
      console.log(`The user ${user.uid} already exists. Do Nothing.`);
    } else {
      console.log(`The user ${user.uid} does not exist, let's create it in firestore`);
      console.log(user);
      let firstName = "";
      let lastName = "";
      if (user.displayName && user.displayName.length > 0) {
        const nameArr = user.displayName.split(' ');
        firstName = nameArr[0];
        lastName = nameArr[1];
      }
      await userRef.set({
        uid: user.uid,
        email: user.email || "",
        city: "",
        country: "",
        dob: "",
        imageURL: user.photoURL ? user.photoURL : "",
        firstName: firstName,
        lastName: lastName,
        phone: user.phoneNumber ? user.phoneNumber : "",
        state: ""
      });
      
      const newStationDoc = stationsRef.collection('MyStations').doc();
      await newStationDoc.set({
        coverPhotoURL: "",
        createDate: admin.firestore.FieldValue.serverTimestamp(),
        description: `PocketNewz Default Station`,
        id: newStationDoc.id,
        isCollaboration: false,
        isPublic: true,
        location: '',
        ownerID: user.uid,
        title: user.displayName ? `${user.displayName}'s Station` : `${user.email}'s Station`
      })

      const stationRefRef = db.collection('StationRef').doc(newStationDoc.id);
      await stationRefRef.set({
        isPublic: true,
        key: `Stations/${user.uid}/MyStations/${newStationDoc.id}`,
        newzCount: 0
      })

      await newzerStatsRef.set({
        followers: 0,
        newzCount: 0,
        stations: 1
      })
    }
  } catch(err) {
    console.log(`There was an error requesting the user snapshot`);
  }
});

export const cloneNewzAssets = functions.https.onRequest((request, response) => {
  cors(request, response, async () => {
    const pathUrlPrefix = 'NewzReels';
    console.log('request', request)
    console.log('request.query', request.query)
    console.log('request.params', request.params)
    console.log('request.body', request.body)
    console.log('request.rawBody', request.rawBody)
    let oldNewzId = request.query.oldNewzId || request.params.oldNewzId;
    let newNewzId = request.query.newNewzId || request.params.newNewzId;
    if (request.body.data) {
      oldNewzId = request.body.data.oldNewzId;
      newNewzId = request.body.data.newNewzId;
    }
    console.log(`oldNewzId: ${oldNewzId} | newNewzId: ${newNewzId}`);
    const newAssetsPath = `${pathUrlPrefix}/${newNewzId}`

    const options = {
      prefix: `${pathUrlPrefix}/${oldNewzId}`
    }

    const [fileObjects] = await bucket.getFiles(options);
    const videoURLs: string[] = [];
    let thumbnailURL;
    for (var i = 0; i < fileObjects.length; i++) {
      const file = fileObjects[i];
      const nameArr = file.name.split('/');
      const name = nameArr[nameArr.length - 1];
      const copyResponse = await file.copy(`${newAssetsPath}/${name}`);
      const newFile = copyResponse[0];
      const cfg: GetSignedUrlConfig = {                                                                      
        action: 'read',                                                               
        expires: '03-01-2500',                                                        
      };
      const signedURL = await newFile.getSignedUrl(cfg);
      console.log(`signedURL for ${newFile.name}`, signedURL);
      if (name.split('.')[1] === 'mp4' || name.split('.')[1] === 'jpg' || name.split('.')[1] === 'png') {
        videoURLs.push(signedURL[0])
      }
      if (name.split('.')[0] === 'thumbnail') {
        thumbnailURL = signedURL
      }
    }

    response.status(200).send({
      data: {
        thumbnailURL: thumbnailURL,
        videoURLs: videoURLs
      }
    });
  })
})

export const followNewzer = functions.https.onRequest((request, response) => {
  cors(request, response, () => {
    try {
      if (request.method !== 'POST') {
        response.status(400).send('not a POST method');
        return;
      }

      const authorization = request.get('Authorization');

      if (authorization) {
        const tokenId = authorization.split('Bearer ')[1];

        admin.auth().verifyIdToken(tokenId)
          .then(async (decoded) => {
            // res.status(200).send(decoded)
            var followerId = decoded.uid; // user that is doing the following
            let followId = request.query.followId || request.params.followId; // user being followed

            const newzerFollowsRef = db.collection('NewzerFollows').doc(followerId); // user that is doing the following
            const newzerStatsRef = db.collection('NewzerStats').doc(followId); // user being followed

            const newzerFollowsSnapshot = await newzerFollowsRef.get();
            const newzerStatsSnapshot = await newzerStatsRef.get();

            newzerStatsSnapshot.then(doc => {
              let followers = doc.data().followers
            }).followers
            let following = newzerFollowsRef.following

            if(following.includes(followId)) {
              following.splice(following.indexOf(followId), 1)
              followers = followers - 1
            } else {
              following.push(followId)
              followers = followers + 1
            }

            newzerFollowsRef.update({following: following})
            newzerStatsRef.update({followers: followers})

            response.send({ status: 'success', following: following, followers: followers });
          }).catch((err) => response.status(401).send(err));
      }
    } catch (error) {
      response.statusCode = 500;
      response.send(error);
    }
  });
});