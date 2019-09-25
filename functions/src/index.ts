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

// Newz Added
export const onNewzAdded = functions.firestore.document('Newz/{newzId}').onCreate(async (snap, context) => {
  try {
    const newzItem = snap.data();
    if (newzItem) {
      const stationIDs = newzItem.stationIDs;
      const ownerID = newzItem.ownerID;
      const newzerStats = await db.collection('NewzerStats').doc(ownerID).get();
      if (!newzerStats.exists) {
        console.log(`the document ${ownerID} does not exist`);
      } else {
        const newzerStatsData = newzerStats.data();
        if (newzerStatsData) {
          const newCount = newzerStatsData.newzCount + 1;
          await db.collection('NewzerStats').doc(ownerID).update({
            newzCount: newCount
          })
        } else {
          console.log(`There is no info for NewzerStats/${ownerID}`);
        }
      }
      stationIDs.forEach(async (stationID: string) => {
        const stationRef = await db.collection('StationRef').doc(stationID).get();
        if (!stationRef.exists) {
          console.log(`the document ${stationID} does not exist`);
        } else {
          const stationInfo = stationRef.data();
          if (stationInfo) {
            const newCount = stationInfo.newzCount + 1;
            await db.collection('StationRef').doc(stationID).update({
              newzCount: newCount
            })
          } else {
            console.log(`There is no station info for ${stationID}`);
          }
        }
      })
    } else {
      console.log('There was no newzItem');
    }
  } catch(err) {
    console.log('err', err);
  }
})

// Newz Destroyed
export const onNewzDestroyed = functions.firestore.document('Newz/{newzId}').onDelete(async (snap, context) => {
  try {
    const newzItem = snap.data();
    if (newzItem) {
      const stationIDs = newzItem.stationIDs;
      const ownerID = newzItem.ownerID;
      const newzerStats = await db.collection('NewzerStats').doc(ownerID).get();
      if (!newzerStats.exists) {
        console.log(`the document ${ownerID} does not exist`);
      } else {
        const newzerStatsData = newzerStats.data();
        if (newzerStatsData) {
          const newCount = newzerStatsData.newzCount - 1;
          await db.collection('NewzerStats').doc(ownerID).update({
            newzCount: newCount < 0 ? 0 : newCount
          })
        } else {
          console.log(`There is no info for NewzerStats/${ownerID}`);
        }
      }
      stationIDs.forEach(async (stationID: string) => {
        const stationRef = await db.collection('StationRef').doc(stationID).get();
        if (!stationRef.exists) {
          console.log(`the document ${stationID} does not exist`);
        } else {
          const stationInfo = stationRef.data();
          if (stationInfo) {
            const newCount = stationInfo.newzCount - 1;
            await db.collection('StationRef').doc(stationID).update({
              newzCount: newCount < 0 ? 0 : newCount
            })
          } else {
            console.log(`There is no station info for ${stationID}`);
          }
        }
      })
    } else {
      console.log('There was no newzItem');
    }
  } catch(err) {
    console.log('err', err);
  }
})

// Newz Rating

// Follow Newzer

// Number of Stations
export const onStationCreated = functions.firestore.document('Stations/{stationID}').onCreate(async (snap, context) => {
  try {
    const stationRef = snap.data();
    if (stationRef) {
      const stationKey = stationRef.key;
      if (stationKey) {
        const stationKeyArr = stationKey.split('/');
        const ownerID = stationKeyArr[1];
        const newzerStats = await db.collection('NewzerStats').doc(ownerID).get();
        if (!newzerStats.exists) {
          console.log(`the document ${ownerID} does not exist`);
        } else {
          const newzerStatsData = newzerStats.data();
          if (newzerStatsData) {
            const newCount = newzerStatsData.newzCount + 1;
            await db.collection('NewzerStats').doc(ownerID).update({
              newzCount: newCount
            })
          } else {
            console.log(`There is no info for NewzerStats/${ownerID}`);
          }
        }
      } else {
        console.log('There was no StationKey');
      }
    } else {
      console.log('There was no StationRef');
    }
  } catch(err) {
    console.log('err', err);
  }
});

export const onStationDestroyed = functions.firestore.document('StationRef/{stationID}').onDelete(async (snap, context) => {
  try {
    const stationRef = snap.data();
    if (stationRef) {
      const stationKey = stationRef.key;
      if (stationKey) {
        const stationKeyArr = stationKey.split('/');
        const ownerID = stationKeyArr[1];
        const newzerStats = await db.collection('NewzerStats').doc(ownerID).get();
        if (!newzerStats.exists) {
          console.log(`the document ${ownerID} does not exist`);
        } else {
          const newzerStatsData = newzerStats.data();
          if (newzerStatsData) {
            const newCount = newzerStatsData.newzCount - 1;
            await db.collection('NewzerStats').doc(ownerID).update({
              newzCount: newCount < 0 ? 0 : newCount
            })
          } else {
            console.log(`There is no info for NewzerStats/${ownerID}`);
          }
        }
      } else {
        console.log('There was no StationKey');
      }
    } else {
      console.log('There was no StationRef');
    }
  } catch(err) {
    console.log('err', err);
  }
});