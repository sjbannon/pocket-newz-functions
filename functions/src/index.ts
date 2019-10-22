import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { GetSignedUrlConfig } from '@google-cloud/storage';

const SENDGRID_API_KEY = functions.config().sendgrid.key;
const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(SENDGRID_API_KEY);

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
    // const userSnapshot = await userRef.get();
    // if (userSnapshot.exists) {
    //   console.log(`The user ${user.uid} already exists. Do Nothing.`);
    // } else {
      // console.log(`The user ${user.uid} does not exist, let's create it in firestore`);
      // console.log(user);
      // let firstName = "";
      // let lastName = "";
      // if (user.displayName && user.displayName.length > 0) {
      //   const nameArr = user.displayName.split(' ');
      //   firstName = nameArr[0];
      //   lastName = nameArr[1];
      // }
    
    // }

    // let firstName = "";
    // let lastName = "";
    // if (user.displayName && user.displayName.length > 0) {
    //   const nameArr = user.displayName.split(' ');
    //   firstName = nameArr[0];
    //   lastName = nameArr[1];
    // }
    
    await userRef.set({
      // firstName: 
      imageURL: user.photoURL ? user.photoURL : "",
      phone: user.phoneNumber ? user.phoneNumber : ""
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
    // }
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

      const metricsRef = db.collection('Metrics').doc(newzItem.id);
      await metricsRef.set({
        views: 0
      })

      if(newzItem.ownerID !== newzItem.posterID) {
        const newzPosterRef = db.collection('UserInfo').doc(newzItem.posterID);
        const newzPosterSnap = await newzPosterRef.get();
        const newzPosterData = newzPosterSnap.data();
        
        if(newzPosterData) {
          const msg = {
            to: newzPosterData.email,
            from: 'noreply@pocketnewz.com',
            subject: 'Pocket Newz - Successfully Contributed',
            // custom templates
            templateId: 'd-83de01c6f1d04cd99ee4b9ac25a92013',
            substitutionWrappers: ['{{', '}}'],
            substitutions: {
              name: `${newzPosterData.firstName} ${newzPosterData.lastName}`,
              title: newzItem.title
            }
          };

          sgMail.send(msg)
          console.log(`Email Sent to ${newzPosterData.email}!`)
        }
      }
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

      await db.collection('Metrics').doc(newzItem.id).delete().then(function() {
        console.log("Metrics successfully deleted!");
      }).catch(function(error) {
          console.error("Error removing metrics: ", error);
      });

      await db.collection('Comments').doc(newzItem.id).delete().then(function() {
        console.log("Comments successfully deleted!");
      }).catch(function(error) {
        console.error("Error removing comments: ", error);
      });

      await db.collection('Ratings').doc(newzItem.id).delete().then(function() {
        console.log("Ratings successfully deleted!");
      }).catch(function(error) {
        console.error("Error removing ratings: ", error);
      });

      await bucket.deleteFiles({
        prefix: `NewzReels/${newzItem.id}`
      }).then(function() {
        console.log("NewzReels successfully deleted!");
      }).catch(function(error) {
        console.error("Error removing NewzReels: ", error);
      });
            
    } else {
      console.log('There was no newzItem');
    }
  } catch(err) {
    console.log('err', err);
  }
})

// Newz Rating
// requires newzID and rating params
export const newzRating = functions.https.onCall(async (data, context) => {
  try {
    if (context && context.auth) {
      var uid = context.auth.uid; // user that is doing the rating
      let newzID = data.newzID; // newz to be rated
      let rating = data.rating; // rating score

      console.log('IDs and rating: ', uid, newzID, rating)

      // Checking attributes.
      if ( (!newzID || newzID.length === 0) || (!rating || rating <= 0) ) {
        // Throwing an HttpsError so that the client gets the error details.
        throw new functions.https.HttpsError('invalid-argument', 'The function must be called with ' +
            'two arguments "newzID" and "rating".');
      }
      // Checking that the user is authenticated.
      if (!context.auth) {
        // Throwing an HttpsError so that the client gets the error details.
        throw new functions.https.HttpsError('failed-precondition', 'The function must be called ' +
            'while authenticated.');
      }

      const ratingsRef = db.collection('Ratings').doc(newzID);
      const myRatingsRef = ratingsRef.collection('MyRatings');

      await myRatingsRef.doc(uid).set({myRating: rating});

      let counter = 0;
      let totalRating = 0;

      const avgRatingRef = ratingsRef.collection('AvgRating').doc(newzID);
      const allRatingsSnap = await myRatingsRef.get();

      allRatingsSnap.forEach((documentSnapshot) => {
        let doc = documentSnapshot.data();
        counter = counter + 1;
        totalRating = totalRating + doc.myRating;
      })

      const newAvg = totalRating / counter;
      await avgRatingRef.set({avgRating: newAvg});

      // Ratings/-LdFoNAOkv_92w2hhFgu/MyRatings/10N8EB9SdvSDe0loZUwjEHLKFGF3

      const ratingsRefRef = db.collection('RatingsRef').doc(uid).collection('MyRatings').doc(newzID);
      await ratingsRefRef.set({ratingsRef: `Ratings/${newzID}/MyRatings/${uid}`})

      return { status: 'success', avgRating: newAvg };
    } else {
      console.log('failed - no context or context.auth', context)
      throw new functions.https.HttpsError('failed-precondition', 'The function must be called ' +
            'while authenticated.');
    }
  } catch (error) {
    console.log('failed', error)
    throw new functions.https.HttpsError('internal', error);
  }
});

// export const newzShared = functions.https.onCall(async (data, context) => {
//   try {
//     if (context && context.auth) {
//       var uid = context.auth.uid; // user that is doing the rating
//       let newzID = data.newzID; // newz to be rated
      
//       // Checking attributes.
//       if (!newzID || newzID.length === 0) {
//         // Throwing an HttpsError so that the client gets the error details.
//         throw new functions.https.HttpsError('invalid-argument', 'The function must be called with ' +
//             'one argument "newzID".');
//       }
//       // Checking that the user is authenticated.
//       if (!context.auth) {
//         // Throwing an HttpsError so that the client gets the error details.
//         throw new functions.https.HttpsError('failed-precondition', 'The function must be called ' +
//             'while authenticated.');
//       }

//       const ratingsRef = db.collection('Ratings').doc(newzID);
//       const myRatingsRef = ratingsRef.collection('MyRatings');

//       await myRatingsRef.doc(uid).set({myRating: rating});

//       let counter = 0;
//       let totalRating = 0;

//       const avgRatingRef = ratingsRef.collection('AvgRating').doc(newzID);
//       const allRatingsSnap = await myRatingsRef.get();

//       allRatingsSnap.forEach((documentSnapshot) => {
//         let doc = documentSnapshot.data();
//         counter = counter + 1;
//         totalRating = totalRating + doc.myRating;
//       })

//       const newAvg = totalRating / counter;
//       await avgRatingRef.set({avgRating: newAvg});

//       // Ratings/-LdFoNAOkv_92w2hhFgu/MyRatings/10N8EB9SdvSDe0loZUwjEHLKFGF3

//       const ratingsRefRef = db.collection('RatingsRef').doc(uid).collection('MyRatings').doc(newzID);
//       await ratingsRefRef.set({ratingsRef: `Ratings/${newzID}/MyRatings/${uid}`})

//       return { status: 'success', avgRating: newAvg };
//     } else {
//       console.log('failed - no context or context.auth', context)
//       throw new functions.https.HttpsError('failed-precondition', 'The function must be called ' +
//             'while authenticated.');
//     }
//   } catch (error) {
//     console.log('failed', error)
//     throw new functions.https.HttpsError('internal', error);
//   }
// });

// Follow Newzer
// Only need the ID of user to follow. The follower is the user that is sending the request
// and we'll receive the token to figure out who they are.
export const followNewzer = functions.https.onCall(async (data, context) => {
  try {
    if (context && context.auth) {
      let following, followers;
      var followerId = context.auth.uid; // user that is doing the following
      let followId = data.followID; // user being followed
      console.log('IDs', followerId, followId);

      // Checking attributes.
      if (!followId || followId.length === 0) {
        // Throwing an HttpsError so that the client gets the error details.
        throw new functions.https.HttpsError('invalid-argument', 'The function must be called with ' +
            'one arguments "followID" containing the ID of the user to follow.');
      }
      // Checking that the user is authenticated.
      if (!context.auth) {
        // Throwing an HttpsError so that the client gets the error details.
        throw new functions.https.HttpsError('failed-precondition', 'The function must be called ' +
            'while authenticated.');
      }

      if(followerId && followId) {
        const newzerFollowsRef = db.collection('NewzerFollows').doc(followerId)
        const newzerFollowsSnap = await newzerFollowsRef.get(); // user that is doing the following

        const newzerStatsRef = db.collection('NewzerStats').doc(followId); // user being followed
        const newzerStatsSnap = await newzerStatsRef.get();

        if(newzerStatsSnap.exists) {
          const newzerStats = newzerStatsSnap.data();
          if(newzerStats) {
            followers = newzerStats.followers || 0;
          }
        }
        
        if(newzerFollowsSnap.exists) {
          const newzerFollows = newzerFollowsSnap.data();
          if(newzerFollows) {
            following = newzerFollows.following || [];
          }
        }
        
        // Checking data is valid.
        if (following === undefined) {
          // Throwing an HttpsError so that the client gets the error details.
          throw new functions.https.HttpsError('not-found', 'The function could not retrieve the authenticated user with ID: '+followerId);
        }
        if (followers === undefined) {
          // Throwing an HttpsError so that the client gets the error details.
          throw new functions.https.HttpsError('not-found', 'The function could not retrieve the user to follow with ID: '+followId);
        }

        if(following.includes(followId)) {
          following.splice(following.indexOf(followId), 1);
          followers = (followers <= 1 ? 0 : followers - 1);
        } else {
          following.push(followId);
          followers = followers + 1;
        }

        await newzerFollowsRef.update({following: following})
        await newzerStatsRef.update({followers: (followers >= 0 ? followers : 0)})

        return { status: 'success', following: following, followers: followers };        
      } else {
        throw new functions.https.HttpsError('not-found', 'The function could not retrieve the following or follower user');
      }
    } else {
      console.log('failed - no context or context.auth', context)
      throw new functions.https.HttpsError('failed-precondition', 'The function must be called ' +
            'while authenticated.');
    }
  } catch (error) {
    console.log('failed', error)
    throw new functions.https.HttpsError('internal', error);
  }
});

// View Newz
// requires newzID
export const viewNewz = functions.https.onCall(async (data, context) => {
  try {
    if (context && context.auth) {
      var uid = context.auth.uid; // user that is doing the rating
      let newzID = data.newzID; // newz to be rated

      console.log('IDs and rating: ', uid, newzID)

      // Checking attributes.
      if (!newzID || newzID.length === 0) {
        // Throwing an HttpsError so that the client gets the error details.
        throw new functions.https.HttpsError('invalid-argument', 'The function must be called with ' +
            'one argument "newzID".');
      }
      // Checking that the user is authenticated.
      if (!context.auth) {
        // Throwing an HttpsError so that the client gets the error details.
        throw new functions.https.HttpsError('failed-precondition', 'The function must be called ' +
            'while authenticated.');
      }

      const newzRef = db.collection('Newz').doc(newzID);
      const newzSnap = await newzRef.get();
      const newzData = newzSnap.data();

      if(newzData && (uid !== newzData.ownerID)) {
        const newzViewUserRef = db.collection('NewzViews').doc(uid);
        const newzViewRef = newzViewUserRef.collection('views').doc(newzID)

        const newzViewSnap = await newzViewRef.get();

        const metricsRef = db.collection('Metrics').doc(newzID);
        const metricsSnap = await metricsRef.get();
        const metricsData = metricsSnap.data();

        let newViews = 0;

        if(metricsData) {
          newViews = metricsData.views;
        }

        if(!newzViewSnap.exists) {
          newViews += 1;
          await metricsRef.set({views: newViews || 0});
          await newzViewRef.set({viewed: true})
        }
        return { status: 'success', newViews: newViews };
      } else {
        console.log('User owns that newz item')
        throw new functions.https.HttpsError('aborted', 'User owns that newz item.');
      }
    } else {
      console.log('failed - no context or context.auth', context)
      throw new functions.https.HttpsError('failed-precondition', 'The function must be called ' +
            'while authenticated.');
    }
  } catch (error) {
    console.log('failed', error)
    throw new functions.https.HttpsError('internal', error);
  }
});

// View Newz
// requires newzID
export const viewSharedNewz = functions.https.onRequest((request, response) => {
  cors(request, response, async () => {
    try {
      console.log('request.body', request.body)
      const newzID = request.body.newzID;

      if (request.method != "POST") {
        response.status(400).send("Incorrect request method.");
        return;
      }
    
      if (newzID) {
        const newzRef = db.collection('Newz').doc(newzID);
        const newzSnap = await newzRef.get();
        const newzData = newzSnap.data();

        if(newzData && newzData.isPublic) {
          const metricsRef = db.collection('Metrics').doc(newzID);
          const metricsSnap = await metricsRef.get();
          const metricsData = metricsSnap.data();

          let newViews = 0;

          if(metricsData) {
            newViews = metricsData.views;
          }

          newViews += 1;
          await metricsRef.set({views: newViews || 0});

          response.status(200).send({
            data: {
              status: 'success', 
              newViews: newViews
            }
          });
        } else {
          console.log('Newz Item not found or not public.')
          response.status(400).send({
            data: {
              status: 'failed',
              error: 'Newz Item not found or not public.'
            }
          });
        }
      } else {
        console.log('newzID not provided in request.')
        response.status(400).send({
          data: {
            status: 'failed',
            error: 'newzID not provided in request.'
          }
        });
      }
    } catch (error) {
      console.log('Error:', error)
      response.status(400).send({
        data: {
          status: 'failed',
          error: error
        }
      });
    }
  });
});

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
            const newCount = newzerStatsData.stations + 1;
            await db.collection('NewzerStats').doc(ownerID).update({
              stations: newCount
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
            const newCount = newzerStatsData.stations - 1;
            await db.collection('NewzerStats').doc(ownerID).update({
              stations: newCount < 0 ? 0 : newCount
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

export const collaboratorAdded = functions.firestore.document('Stations/{userID}/Collaborating/{stationID}').onCreate(async (snap, context) => {
  try {
    const collabStationData = snap.data();

    const userID = context.params.userID;
    const userRef = db.collection('UserInfo').doc(userID);
    const userSnap = await userRef.get();
    const user = userSnap.data();

    if (collabStationData && user) {
      const stationRef =    db.doc(collabStationData.stationRef);
      const stationSnap = await stationRef.get();
      const stationData = stationSnap.data();

      const stationOwnerID = collabStationData.ownerID;
      const stationOwnerRef = db.collection('UserInfo').doc(stationOwnerID);
      const stationOwnerSnap = await stationOwnerRef.get();
      const stationOwnerData = stationOwnerSnap.data();

      if(stationData && stationOwnerData) {
        const msg = {
          to: user.email,
          from: 'noreply@pocketnewz.com',
          subject: 'Pocket Newz - Added as Contributor',
          // custom templates
          templateId: 'd-83de01c6f1d04cd99ee4b9ac25a92013',
          substitutionWrappers: ['{{', '}}'],
          substitutions: {
            contributorName: `${user.firstName} ${user.lastName}`,
            stationUsername: `${stationOwnerData.firstName} ${stationOwnerData.lastName}`,
            stationName: stationData.title,
            stationID: stationData.id
          }
        };

        return sgMail.send(msg)
      }
    } else {
      console.log('No user or collab station found.');
    }
  } catch(err) {
    console.log('err', err);
  }
})

export const inviteContributor = functions.https.onCall(async (data, context) => {
  try {
    if (context && context.auth) {
      var uid = context.auth.uid; // user that is doing the rating
      let contributorID = data.uid; // newz to be rated
      let stationID = data.stationID; // rating score

      console.log('IDs and rating: ', uid, contributorID, stationID)

      // Checking that the user is authenticated.
      if (!context.auth) {
        // Throwing an HttpsError so that the client gets the error details.
        throw new functions.https.HttpsError('failed-precondition', 'The function must be called while authenticated.');
      }

      // Checking attributes.
      if ( (!contributorID || !contributorID.length) || (!stationID || !stationID.length) ) {
        // Throwing an HttpsError so that the client gets the error details.
        throw new functions.https.HttpsError('invalid-argument', 'The function must be called with two arguments "contributorID" and "stationID".');
      }

      const stationRef = db.collection('Stations').doc(`${uid}/MyStations/${stationID}`);
      const stationSnapshot = await stationRef.get();
      const stationData = stationSnapshot.data();

      if (stationSnapshot.exists && stationData) {
        const contributorStationRef = db.collection('Stations').doc(`${contributorID}/Collaborating/${stationID}`);
        const contributorStationSnapshot = await contributorStationRef.get();

        if (contributorStationSnapshot.exists) {
          console.log('contributorStationSnapshot exists', contributorStationSnapshot.data())
          return {status: 'already-exists', message: 'User is already a contributor to this station.'}
        } else {
          console.log('contributorStationSnapshot doesnt exist', contributorStationSnapshot.data())
          // add them as a contrib
          const stationPath = `Stations/${contributorID}/Collaborating/${stationID}`;
          await contributorStationRef.set({
            createdDate: admin.firestore.Timestamp.now(),
            id: stationData.id, 
            stationRef: stationPath,
            ownerID: stationData.ownerID
          })

          return { status: 'success', contributorStationRef: stationPath};
        }
      } else {
        throw new functions.https.HttpsError('internal', 'Station does not exist for user.');
      }      
    } else {
      console.log('failed - no context or context.auth', context)
      throw new functions.https.HttpsError('failed-precondition', 'The function must be called while authenticated.');
    }
  } catch (error) {
    console.log('failed', error)
    throw new functions.https.HttpsError('internal', error);
  }
});
