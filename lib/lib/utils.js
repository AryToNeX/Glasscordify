/*
   Copyright 2020 AryToNeX

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
*/
"use strict";

const { execSync } = require("child_process");
const path = require("path");
const https = require("https");
const os = require("os");
const asar = require("asar");
const glob = require("glob");
const winShortcut = require("windows-shortcuts-ps");
const argvSplit = require("argv-split");

const originalFs = require("./original-fs.js");
const extraFs = require("fs-extra");

const rimraf = require("./rimraf-electron");
const traverser = require("./traverser.js");
const rootApps = require("./root_applications.json");
const appBlacklist = require("./blacklist.json");

const minElectronVersion = "7.1.0";

class Utils{
	static httpsGet(url, options, callback){
		https.get(url, options, result => {
			if(result.statusCode == 301 || result.statusCode == 302){
				this.httpsGet(result.headers.location, options, callback);
				return;
			}
			let data = Buffer.alloc(0);
			result.on("data", chunk => {data = Buffer.concat([data, chunk])});
			result.on("end", () => {
				result.data = data;
				callback(result);
			});
		});
	}

	static isGlasscordDownloaded(){
		const _path = path.resolve(this.getConfigPath(), "glasscord", "_bin", "glasscord.asar");
		return originalFs.existsSync(_path);
	}

	static async downloadGlasscordAsar(){
		let promise = await new Promise((resolve, reject) => {
			// CALL TO THE GITHUB RELEASES API
			this.httpsGet("https://api.github.com/repos/AryToNeX/Glasscord/releases/latest", {headers: {"user-agent": "glasscordify"}}, result => {
				// Let's check the error
				if(result.statusCode != 200)
					return resolve(false);

				let data = JSON.parse(result.data);
				// Let's traverse the assets array to find our object!
				let url;
				for(let asset of data.assets){
					if(asset.name == "glasscord.asar"){
						url = asset.browser_download_url;
						break;
					}
				}

				// Let's download it!
				this.httpsGet(url, {headers: {"user-agent": "glasscordify"}}, file => {
					// Again, let"s check for errors
					if(file.statusCode != 200)
						return resolve(false);

					// Save data
					extraFs.ensureDirSync(path.resolve(this.getConfigPath(), "glasscord", "_bin"));
					originalFs.writeFileSync(path.resolve(this.getConfigPath(), "glasscord", "_bin", "glasscord._asar"), file.data);
					originalFs.renameSync(path.resolve(this.getConfigPath(), "glasscord", "_bin", "glasscord._asar"), path.resolve(this.getConfigPath(), "glasscord", "_bin", "glasscord.asar"))
					return resolve(true);
				});
			});
		});
		return promise;
	}

	static getConfigPath(){
		let homedir = os.homedir();
		switch(process.platform){
			case "win32":
				return path.resolve(process.env.APPDATA) || path.resolve(homedir, "AppData", "Roaming");
			case "linux":
				homedir = execSync("grep $(logname) /etc/passwd | cut -d \":\" -f6").toString().trim()
			default:
				return path.resolve(homedir, ".config");
			case "darwin":
				return path.resolve(homedir, "Library", "Application Support");
		}
	}

	static linkGlasscordToAppPath(_appPath, shim = undefined){
		const glasscordPath = path.resolve(this.getConfigPath(), "glasscord", "_bin", "glasscord.asar");
		let linkPath = path.resolve(_appPath, "glasscord.asar");
		
		if(originalFs.existsSync(linkPath))
			originalFs.unlinkSync(linkPath); // YEETUS

		if(process.platform === "win32") // DUMB SHIT INCOMING
			originalFs.copyFileSync(glasscordPath, linkPath);
		else {
			originalFs.symlinkSync(glasscordPath, linkPath);
			this._ensureChown(linkPath);
		}

		if(typeof shim !== "undefined"){
			linkPath = path.resolve(_appPath, "glasscord_shim.js");
			const asarPath = path.resolve(_appPath, "glasscord.asar");
			originalFs.writeFileSync(linkPath, shim.toString().replace("{GLASSCORD_ASAR_LOCATION}", asarPath));
			this._ensureChown(linkPath);
		}
		return linkPath;
	}

	static unlinkGlasscordFromAppPath(_appPath){
		const glasscordPath = path.resolve(_appPath, "glasscord.asar");
		const shimPath = path.resolve(_appPath, "glasscord_shim.js");

		if(!originalFs.existsSync(glasscordPath)) return false;

		originalFs.unlinkSync(glasscordPath);
		if(originalFs.existsSync(shimPath)) originalFs.unlinkSync(shimPath);
		return true;
	}

	static patchMainFile(_mainFile, _glasscordPath){
		if(this.isMainFilePatched(_mainFile)) return false;

		const _require = `// GLASSCORD BEGIN\nrequire("${_glasscordPath.split("\\").join("/")}");\n// GLASSCORD END\n`;
		const newFile = _require + originalFs.readFileSync(_mainFile);
		originalFs.writeFileSync(_mainFile, newFile);
		return true;
	}

	static revertMainFile(_mainFile){
		if(this.isMainFilePatched(_mainFile)){
			const oldFile = originalFs.readFileSync(_mainFile).toString();
			originalFs.writeFileSync(_mainFile, oldFile.replace(/^\/\/ GLASSCORD BEGIN\nrequire\(.*\);\n\/\/ GLASSCORD END\n/, ""));
			return true;
		}
		return false;
	}

	static isMainFilePatched(_mainFile){
		const file = originalFs.readFileSync(_mainFile).toString();
		return file.match(/^\/\/ GLASSCORD BEGIN\nrequire\(.*\);\n\/\/ GLASSCORD END\n/) !== null;
	}

	static determineMainFile(_appPath){
		if(originalFs.existsSync(path.resolve(_appPath, "package.json")))
			return this.__determineMainFile(path.resolve(_appPath, "package.json"));
		return undefined;
	}

	static __determineMainFile(_packageJson){
		if(!path.isAbsolute(_packageJson)) return undefined;
		try{
			const pak = require(_packageJson);
			let main = path.resolve(path.dirname(_packageJson), pak.main);
			if(originalFs.existsSync(main) && originalFs.lstatSync(main).isDirectory()){
				// If main is a directory then we look for package.json and we'll call this function again
				if(originalFs.existsSync(path.resolve(main, "package.json")))
					return this.__determineMainFile(path.resolve(main, "package.json"));
				
				// If main is a directory without package.json, then we look for index.js
				if(originalFs.existsSync(path.resolve(main, "index.js")))
					return path.resolve(main, "index.js");
			}
			// We're assuming the main is NOT a directory from now on!
			
			// Common case to refer to a JS file without specifying the JS extension
			if(path.extname(main) === "")
				main += ".js";

			// Check for the existence of a JS file and return it
			if(path.extname(main) === ".js" && originalFs.existsSync(main))
				return main;

			// If nothing was satisfied, return undefined
			return undefined;
		}catch(e){
			return undefined;
		}
	}

	static determineAppName(_appPath){
		try{
			const pak = require(path.resolve(_appPath, "package.json"));
			if(pak.name !== "Electron")
				return pak.name;
			return undefined;
		}catch(e){
			return undefined;
		}
	}

	static determineRootAppName(_appName){
		if(typeof _appName === "undefined") return undefined;
		for(let rootAppName in rootApps)
			for(let possibleCurrentApp of rootApps[rootAppName])
				if(_appName === possibleCurrentApp) return rootAppName;
		return _appName;
	}

	static isAppBlacklisted(_rootAppName){
		return appBlacklist.includes(_rootAppName);
	}

	static getShim(appName){
		const filePath = path.resolve(__dirname, "shims", appName + ".js");
		if(originalFs.existsSync(filePath)) return originalFs.readFileSync(filePath);
		return undefined;
	}

	static determineIfGlasstronApp(_appPath){
		const pak = require(path.resolve(_appPath, "package.json"));
		return (pak.dependencies.hasOwnProperty("glasstron") || pak.devDependencies.hasOwnProperty("glasstron"))
	}

	static determineAppType(_resourcesPath){
		if(originalFs.existsSync(path.resolve(_resourcesPath, "_app"))) return "asar:patched";
		if(originalFs.existsSync(path.resolve(_resourcesPath, "app"))) return "folder";
		if(originalFs.existsSync(path.resolve(_resourcesPath, "app.asar"))) return "asar";
		if(originalFs.existsSync(path.resolve(_resourcesPath, "app.js"))) return "js";
		return false;
	}

	static extractAsar(_resourcesPath){
		asar.extractAll(path.resolve(_resourcesPath, "app.asar"), path.resolve(_resourcesPath, "app.gcextracted"));
		return true;
	}

	static moveAsarToBackupFolder(_resourcesPath){
		originalFs.mkdirSync(path.resolve(_resourcesPath, "_app"));
		originalFs.renameSync(path.resolve(_resourcesPath, "app.asar"), path.resolve(_resourcesPath, "_app", "app.asar"));
		if(originalFs.existsSync(path.resolve(_resourcesPath, "app.asar.unpacked")))
			originalFs.renameSync(path.resolve(_resourcesPath, "app.asar.unpacked"), path.resolve(_resourcesPath, "_app", "app.asar.unpacked"));
		if(originalFs.existsSync(path.resolve(_resourcesPath, "app")))
			extraFs.copySync(path.resolve(_resourcesPath, "app"), path.resolve(_resourcesPath, "_app", "app"));
		return true;
	}

	static commitAsarExtraction(_resourcesPath){
		originalFs.renameSync(path.resolve(_resourcesPath, "app.gcextracted"), path.resolve(_resourcesPath, "app"));
		return true;
	}

	static revertAsarPatching(_resourcesPath){
		if(originalFs.existsSync(path.resolve(_resourcesPath, "_app"))){
			originalFs.renameSync(path.resolve(_resourcesPath, "app"), path.resolve(_resourcesPath, "app.delete"));
			originalFs.renameSync(path.resolve(_resourcesPath, "_app", "app.asar"), path.resolve(_resourcesPath, "app.asar"));
			if(originalFs.existsSync(path.resolve(_resourcesPath, "_app", "app.asar.unpacked")))
				originalFs.renameSync(path.resolve(_resourcesPath, "_app", "app.asar.unpacked"), path.resolve(_resourcesPath, "app.asar.unpacked"));
			if(originalFs.existsSync(path.resolve(_resourcesPath, "app")))
				originalFs.renameSync(path.resolve(_resourcesPath, "_app", "app"), path.resolve(_resourcesPath, "app"));
			rimraf.sync(path.resolve(_resourcesPath, "_app"), {glob: false});
			rimraf.sync(path.resolve(_resourcesPath, "app.delete"), {glob: false});
			return true;
		}
		return false;
	}

	static getAppRootPath(_appExecutablePath){
		if(path.basename(_appExecutablePath) === "Electron Framework"){
			// HECK WE'RE PATCHING A MACOS RELEASE
			let pathArray = _appExecutablePath.split(path.sep);
			while(pathArray.length !== 0){
				const last = pathArray.pop();
				if([".app"].includes(path.extname(last))){
					return path.resolve(...pathArray, last);
				}
			}
			return undefined;
		}
		
		return path.resolve(_appExecutablePath, "..");
	}

	static getResourcesPath(_appRootPath){
		if(originalFs.existsSync(path.resolve(_appRootPath, "resources")))
			return path.resolve(_appRootPath, "resources");
		
		if(originalFs.existsSync(path.resolve(_appRootPath, "Resources")))
			return path.resolve(_appRootPath, "Resources");
		
		return undefined;
	}

	static getAbsoluteExecutableFile(_probableLink){ // TODO: Testing and fixing
		const ext = path.extname(_probableLink);
		switch(ext){
			case "": // Linux executable
			case ".exe": // Windows executable
				return Promise.resolve(_probableLink);
			case ".desktop": // Linux desktop file
				const file = originalFs.readFileSync(_probableLink, {encoding: 'utf-8'});
				let exec = file.match(/^Exec=(.*)/m);
				if(exec.length === 0) return Promise.resolve(undefined);

				const execArgs = argvSplit(exec[1]);
				console.log(execArgs)
				if(path.isAbsolute(execArgs[0]))
					return Promise.resolve(execArgs[0]);

				let filePath = file.match(/^Path=(.*)/m);
				let paths = process.env.PATH.split(":");
				if(filePath.length !== 0) paths.unshift(filePath[1]);
				for(let _path of paths)
					if(originalFs.existsSync(path.resolve(_path, execArgs[0])))
						return Promise.resolve(path.resolve(_path, execArgs[0]));

				return Promise.resolve(undefined);
			case ".lnk": // Windows shortcut
				if(process.platform !== "win32") return Promise.resolve(undefined);
				return winShortcut.getPath(_probableLink);
			case ".app": // macOS application folder that seems an executable to macOS users
				return Promise.resolve(originalFs.readlinkSync(path.resolve(_probableLink, "Contents", "Frameworks", "Electron Framework.framework", "Electron Framework")));
		}
		return Promise.resolve(undefined);
	}

	static getElectronVersion(_appExecutablePath){
		let _electronVersion = undefined;
		const electronVersion = traverser.traverseFileWithRegex(_appExecutablePath, /Electron\/([0-9\.]*)/, 5 * 1024 * 1024);
		if(electronVersion.length !== 0)
			_electronVersion = electronVersion[1][1];
		return _electronVersion;
	}

	static isElectronVersionSupported(_electronVersion){
		if(typeof _electronVersion === "undefined") return undefined;
		return this.versionCompare(minElectronVersion, _electronVersion, {zeroExtend: true}) <= 0;
	}

	// https://stackoverflow.com/questions/6832596/how-to-compare-software-version-number-using-js-only-number
	static versionCompare(v1, v2, options) {
		var lexicographical = options && options.lexicographical,
			zeroExtend = options && options.zeroExtend,
			v1parts = v1.split("."),
			v2parts = v2.split(".");

		function isValidPart(x) {
			return (lexicographical ? /^\d+[A-Za-z]*$/ : /^\d+$/).test(x);
		}

		if(!v1parts.every(isValidPart) || !v2parts.every(isValidPart)) return NaN;

		if(zeroExtend) {
			while (v1parts.length < v2parts.length) v1parts.push("0");
			while (v2parts.length < v1parts.length) v2parts.push("0");
		}

		if (!lexicographical) {
			v1parts = v1parts.map(Number);
			v2parts = v2parts.map(Number);
		}

		for (var i = 0; i < v1parts.length; ++i) {
			if (v2parts.length == i) return 1;
			if (v1parts[i] == v2parts[i]) continue;
			else if (v1parts[i] > v2parts[i]) return 1;
			else return -1;
		}

		if (v1parts.length != v2parts.length) return -1;

		return 0;
	}

	static _ensureChown(file){
		if (os.userInfo().uid === 0) {
			execSync(`chown $(logname) "${file.replace(/"/g, '\\"')}"`)
		}
	}
}

module.exports = Utils;
