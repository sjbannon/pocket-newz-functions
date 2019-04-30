import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

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
    fileObjects.forEach(async file => {
      const nameArr = file.name.split('/');
      const name = nameArr[nameArr.length - 1];
      await file.copy(`${newAssetsPath}/${name}`);
      await file.
    })

    response.send(fileObjects);
  })
})