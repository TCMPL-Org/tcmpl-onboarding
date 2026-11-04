'use strict';
// Private document storage (Azure Blob Storage).
// App settings:
//   STORAGE_CONNECTION_STRING  from the storage account's "Access keys" page
//   STORAGE_CONTAINER          container name (default: candidate-docs). Always private.

let ready = null;

function storageConfigured() { return Boolean(process.env.STORAGE_CONNECTION_STRING); }

function container() {
  if (ready) return ready;
  ready = (async () => {
    const { BlobServiceClient } = require('@azure/storage-blob');
    const svc = BlobServiceClient.fromConnectionString(process.env.STORAGE_CONNECTION_STRING);
    const c = svc.getContainerClient(process.env.STORAGE_CONTAINER || 'candidate-docs');
    await c.createIfNotExists(); // no access option = private
    return c;
  })();
  ready.catch(() => { ready = null; });
  return ready;
}

async function putFile(path, buffer, contentType) {
  const c = await container();
  await c.getBlockBlobClient(path).uploadData(buffer, { blobHTTPHeaders: { blobContentType: contentType } });
  return path;
}

async function getFile(path) {
  const c = await container();
  const blob = c.getBlobClient(path);
  const props = await blob.getProperties();
  return { buffer: await blob.downloadToBuffer(), contentType: props.contentType || 'application/octet-stream' };
}

async function deleteFile(path) {
  const c = await container();
  await c.getBlobClient(path).deleteIfExists();
}

module.exports = { storageConfigured, putFile, getFile, deleteFile };
