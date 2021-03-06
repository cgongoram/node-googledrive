"use strict";

const path = require("path");
const stream = require("stream");
const url = require("url");
const https = require("https");

class GoogleDriveFs {
    constructor(options) {
        this._id = options.id;
        this._context = options.context;
        this._property = options.property || null;
    }

    get isFolder() {
        return this._property.mimeType === "application/vnd.google-apps.folder";
    }

    get name() {
        return this._property.name;
    }

    get base() {
        return path.basename(this._property.name, path.extname(this._property.name));
    }

    get ext() {
        return path.extname(this._property.name);
    }

    initialize() {
        if (this._property === null) {
            return this._context.checkToken().then(() => {
                return new Promise((resolve, reject) => {
                    this._context._drive.files.get({
                        fileId: this._id
                    }, (err, res) => {
                        if (err) {
                            reject(err);
                            return;
                        }

                        this._property = res;

                        resolve();
                    });
                });
            });
        } else {
            return Promise.resolve();
        }
    }

    toFile() {
        return new GoogleDriveFile({
            id: this._id,
            context: this._context,
            property: this._property
        });
    }

    toFolder() {
        return new GoogleDriveFolder({
            id: this._id,
            context: this._context,
            property: this._property
        });
    }

    parents() {
        let promise = Promise.resolve();
        const items = [];

        this._property.parents.forEach(parent => {
            promise = promise.then(() => {
                const folder = new GoogleDriveFolder({
                    id: parent.id,
                    context: this._context
                });

                return folder.initialize().then(() => {
                    items.push(folder);

                    return;
                });
            });
        });

        promise = promise.then(() => {
            return items;
        });

        return promise;
    }

    copy(name) {
        return this._context.checkToken().then(() => {
            return new Promise((resolve, reject) => {
                this._context._drive.files.copy({
                    fileId: this._id,
                    resource: {
                        name: name
                    }
                }, (err, res) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    const item = new GoogleDriveFs({
                        id: res.id,
                        context: this._context,
                        property: res
                    });

                    resolve(item.isFolder ? item.toFolder() : item.toFile());
                });
            });
        });
    }

    delete() {
        return this._context.checkToken().then(() => {
            return new Promise((resolve, reject) => {
                this._context._drive.files.delete({
                    fileId: this._id
                }, err => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    resolve();
                });
            });
        });
    }

    getList(query) {
        return this._context.checkToken().then(() => {
            return new Promise((resolve, reject) => {
                let files = [];
                let getFiles;

                (getFiles = pageToken => {
                    this._context._drive.files.list({
                        pageToken: pageToken,
                        q: query,
                        fields: "files,kind,nextPageToken"
                    }, (err, res) => {
                        if (err) {
                            reject(err);
                            return;
                        }

                        files = files.concat(res.files);

                        if (res.hasOwnProperty("nextPageToken")) {
                            getFiles(res.nextPageToken);
                        } else {
                            resolve(files);
                        }
                    });
                })();
            });
        }).then(files => {
            let promise = Promise.resolve();
            const items = [];

            files.forEach(file => {
                promise = promise.then(() => {
                    const item = new GoogleDriveFs({
                        id: file.id,
                        context: this._context,
                        property: file
                    });

                    return item.initialize().then(() => {
                        items.push(item.isFolder ? item.toFolder() : item.toFile());

                        return;
                    });
                });
            });

            promise = promise.then(() => {
                return items;
            });

            return promise;
        });
    }

    getFiles(query) {
        return this.getList(query).then(items => {
            return items.filter(item => !item.isFolder);
        });
    }

    getFolders(query) {
        return this.getList(query).then(items => {
            return items.filter(item => item.isFolder);
        });
    }
}

class GoogleDriveFile extends GoogleDriveFs {
    constructor(options) {
        super(options);
    }

    update(readable) {
        return this._context.checkToken().then(() => {
            return new Promise((resolve, reject) => {
                this._context._drive.files.update({
                    media: {
                        body: readable
                    }
                }, (err, res) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    this._property = res;

                    resolve();
                });
            });
        });
    }

    download() {
        return this._context.checkToken().then(() => {
            /*return new Promise(resolve => {
                resolve(this._context._drive.files.get({
                    fileId: this._id,
                    alt: "media"
                }));
            });*/
            return new Promise((resolve, reject) => {
                const opt = {
                    host: "www.googleapis.com",
                    path: `/drive/v3/files/${this._id}?alt=media`,
                    method: "GET",
                    headers: {
                        Authorization: `${this._context._token.token_type} ${this._context._token.access_token}`
                    }
                };

                const req = https.request(opt, res => {
                    if (res.statusCode !== 200) {
                        reject(new Error(`Status code is ${res.statusCode}`));
                        return;
                    }

                    resolve(res);
                });

                req.on("error", err => {
                    reject(err);
                });

                req.end();
            });
        });
    }
}

class GoogleDriveFolder extends GoogleDriveFs {
    constructor(options) {
        super(options);
    }

    createFolder(name) {
        return this._context.checkToken().then(() => {
            return new Promise((resolve, reject) => {
                this._context._drive.files.create({
                    resource: {
                        name: name,
                        mimeType: "application/vnd.google-apps.folder",
                        parents: [this._id]
                    }
                }, (err, res) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    const folder = new GoogleDriveFolder({
                        id: res.id,
                        context: this._context,
                        property: res
                    });

                    resolve(folder);
                });
            });
        });
    }

    createFile(name, mimeType) {
        return this._context.checkToken().then(() => {
            return new Promise((resolve, reject) => {
                this._context._drive.files.create({
                    resource: {
                        name: name,
                        mimeType: mimeType,
                        parents: [this._id]
                    }
                }, (err, res) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    const file = new GoogleDriveFile({
                        id: res.id,
                        context: this._context,
                        property: res
                    });

                    resolve(file);
                });
            });
        });
    }

    uploadFile(name, mimeType, readable) {
        return this._context.checkToken().then(() => {
            return new Promise((resolve, reject) => {
                this._context._drive.files.create({
                    resource: {
                        name: name,
                        mimeType: mimeType,
                        parents: [this._id]
                    },
                    media: {
                        mimeType: mimeType,
                        body: readable
                    }
                }, (err, res) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    const file = new GoogleDriveFile({
                        id: res.id,
                        context: this._context,
                        property: res
                    });

                    resolve(file);
                });
            });
        });
    }

    uploadFileResumable(name, mimeType, contentLength, readableCallback) {
        return this._context.checkToken().then(() => {
            return new Promise((resolve, reject) => {
                const opt = {
                    host: "www.googleapis.com",
                    path: "/upload/drive/v3/files?uploadType=resumable",
                    method: "POST",
                    headers: {
                        Authorization: `${this._context._token.token_type} ${this._context._token.access_token}`,
                        "Content-Type": "application/json",
                        "X-Upload-Content-Type": mimeType,
                        "X-Upload-Content-Length": contentLength
                    }
                };

                const req = https.request(opt, res => {
                    if (res.statusCode !== 200) {
                        reject(new Error(`Status code is ${res.statusCode}`));
                        return;
                    }

                    resolve(res.headers.location);
                });

                req.on("error", err => {
                    reject(err);
                });

                req.write(JSON.stringify({
                    name: name,
                    parents: [this._id]
                }));

                req.end();
            }).then(sessionUri => {
                return new Promise((resolve, reject) => {
                    let promise = Promise.resolve();

                    const upload = () => {
                        promise = promise.then(() => {
                            return new Promise((resolve2, reject2) => {
                                const opt = {
                                    host: url.parse(sessionUri).host,
                                    path: url.parse(sessionUri).path,
                                    method: "PUT",
                                    headers: {
                                        "Content-Length": "0",
                                        "Content-Range": `bytes */${contentLength}`
                                    }
                                };

                                const req = https.request(opt, res => {
                                    if (res.statusCode === 200) {
                                        resolve();
                                        reject2();
                                        return;
                                    }
                                    if (res.statusCode === 308) {
                                        const rangeKey = Object.keys(res.headers).find(key => key.toLowerCase() === "range");
                                        if (rangeKey === void 0) {
                                            resolve2(0);
                                        } else {
                                            resolve2(Number.parseInt(res.headers[rangeKey].split("-")[1], 10) + 1);
                                        }
                                        return;
                                    }

                                    reject(new Error(`Status code is ${res.statusCode}`));
                                    reject2();
                                });

                                req.on("error", err => {
                                    reject(err);
                                    reject2();
                                });

                                req.end();
                            });
                        }).then(position => {
                            return Promise.all([Promise.resolve(position), readableCallback(position)]);
                        }).then(arg => {
                            return new Promise((resolve2, reject2) => {
                                const position = arg[0];
                                const readable = arg[1];

                                if (!(readable instanceof stream.Stream)) {
                                    reject(new Error("Readable is not stream"));
                                    reject2();
                                    return;
                                }

                                const opt = {
                                    host: url.parse(sessionUri).host,
                                    path: url.parse(sessionUri).path,
                                    method: "PUT",
                                    headers: {
                                        "Content-Length": contentLength - position,
                                        "Content-Range": `bytes ${position}-${contentLength - 1}/${contentLength}`,
                                        "Content-Type": mimeType
                                    }
                                };

                                let isUploadEnd = false;

                                const req = https.request(opt, res => {
                                    if (isUploadEnd) return;

                                    readable.unpipe(req);
                                    readable.emit("uploadEnd");

                                    isUploadEnd = true;

                                    if (res.statusCode !== 200) {
                                        upload();
                                        resolve2();
                                        return;
                                    }

                                    resolve();
                                    reject2();
                                });

                                req.once("error", () => {
                                    if (isUploadEnd) return;

                                    readable.unpipe(req);
                                    readable.emit("uploadEnd");
                                    req.abort();

                                    upload();
                                    resolve2();

                                    isUploadEnd = true;
                                });

                                readable.once("uploadAbort", () => {
                                    if (isUploadEnd) return;

                                    readable.unpipe(req);
                                    readable.emit("uploadEnd");
                                    req.abort();

                                    reject(new Error("Abort upload"));
                                    reject2();

                                    isUploadEnd = true;
                                });

                                readable.pipe(req);
                                readable.emit("uploadStart");
                            });
                        }).catch(() => {
                            // Nothing
                        });
                    };

                    upload();
                });
            });
        });
    }

    children(query) {
        if (query === void 0) {
            query = `'${this._id}' in parents`;
        } else {
            query = `(${query}) and '${this._id}' in parents`;
        }

        return this.getList(query);
    }

    childFiles(query) {
        return this.children(query).then(items => {
            return items.filter(item => !item.isFolder);
        });
    }

    childFolders(query) {
        return this.children(query).then(items => {
            return items.filter(item => item.isFolder);
        });
    }
}

module.exports = {
    File: GoogleDriveFile,
    Folder: GoogleDriveFolder
};
