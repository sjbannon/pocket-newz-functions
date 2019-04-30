import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { GetSignedUrlConfig } from '@google-cloud/storage';

admin.initializeApp();

const cors = require('cors')({ origin: true });

const storage = admin.storage();
const bucket = storage.bucket('mobile-ios-pocketnewz.appspot.com');

export const cloneNewzAssets = functions.https.onRequest((request, response) => {
  cors(request, response, async () => {
    const pathUrlPrefix = 'NewzReels';
    const oldNewzId = request.query.oldNewzId;
    const newNewzId = request.query.newNewzId;
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
      if (name.split('.')[1] === 'mp4') {
        videoURLs.push(signedURL[0])
      }
      if (name.split('.')[0] === 'thumbnail') {
        thumbnailURL = signedURL
      }
    }

    response.send({
      thumbnailURL: thumbnailURL,
      videoURLs: videoURLs
    });
  })
})