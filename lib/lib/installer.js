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

const path = require("path");
const Utils = require("./utils.js");
const rimraf = require("./rimraf-electron");

class Installer{

	static install(app){
		if(app.error) return app;
		if(app.isPatched) return {error: "App is already patched"};

		if(typeof app.electronVersion !== "undefined"){
			let error = false
			if(typeof app.isSupported === "undefined") error = {error: "Unable to determine Electron version"};
			if(!app.isSupported) error = {error: "Electron version is not supported"};

			if(error !== false)
				return error;
		}
		
		if(app.isBlacklisted)
			return {error: "App is blacklisted"};
		
		const shim = Utils.getShim(app.rootAppName);
		const glasscordPath = Utils.linkGlasscordToAppPath(app.appPath, shim);
		if(Utils.patchMainFile(app.mainFile, glasscordPath)) return {success: true};
		return {error: "Unable to patch the application"};
	}

	static uninstall(app){
		if(app.error) return app;
		if(!app.isPatched) return {error: "App is not patched"};
		
		if(app.appPathType === "asar:patched"){ // we can easily "unpatch" this
			if(!Utils.revertAsarPatching(app.resourcesPath))
				return {error: "Couldn't revert changes to the app"};
		}else{
			Utils.unlinkGlasscordFromAppPath(app.appPath);
			Utils.revertMainFile(app.mainFile);
		}
		return {success: true};
	}

	static checkApp(_appExecutablePath, options = {
		electronVersion: true,
		revertTempChangesIfBlacklisted: true,
		revertTempChangesIfUnsupported: true
	}){
		let result = {}
		result.appRootPath = Utils.getAppRootPath(_appExecutablePath);
		result.resourcesPath = Utils.getResourcesPath(result.appRootPath);
		result.appPathType = Utils.determineAppType(result.resourcesPath);
		
		if(!result.appPathType) return {error: "App path not found"};
		
		if(options.electronVersion){
			result.electronVersion = Utils.getElectronVersion(_appExecutablePath);
			result.isSupported = Utils.isElectronVersionSupported(result.electronVersion);
			
			if(result.appPathType == "asar" && !result.isSupported && options.revertTempChangesIfUnsupported){
				rimraf.sync(path.join(result.resourcesPath, "app.gcextracted"), {glob: false});
				result.tempFolderWasRemoved = true;
			}
		}

		switch(result.appPathType){
			case "js":
				result.appPath = result.resourcesPath;
				result.mainFile = path.join(result.resourcesPath, "app.js");
				result.appName = "app";
				result.rootAppName = "app";
				break;
			case "asar:patched":
				result.isPatched = true;
				result.appPath = path.join(result.resourcesPath, "app");
				result.mainFile = Utils.determineMainFile(result.appPath);
				result.appName = Utils.determineAppName(result.appPath);
				result.rootAppName = Utils.determineRootAppName(result.appName);
			break;
			case "asar":
				if(!Utils.extractAsar(result.resourcesPath))
					return {error: "Problem upon extracting of app.asar"};
				result.appPath = path.join(result.resourcesPath, "app.gcextracted");
				result.mainFile = Utils.determineMainFile(result.appPath);
				result.appName = Utils.determineAppName(result.appPath);
				result.rootAppName = Utils.determineRootAppName(result.appName);
				break;
			case "folder":
				result.appPath = path.join(result.resourcesPath, "app");
				result.mainFile = Utils.determineMainFile(result.appPath);
				result.appName = Utils.determineAppName(result.appPath);
				result.rootAppName = Utils.determineRootAppName(result.appName);
				break;
		}
		
		if(typeof result.mainFile === "undefined") return {error: "Can't determine the app's entry point"};
		if(typeof result.appName === "undefined") return {error: "Can't determine the app's name"};
		
		result.isPatched = result.isPatched || Utils.isMainFilePatched(result.mainFile);
		result.isBlacklisted = Utils.isAppBlacklisted(result.rootAppName);
		
		if(result.appPathType == "asar" && result.isBlacklisted && options.revertTempChangesIfBlacklisted){
			rimraf.sync(path.join(result.resourcesPath, "app.gcextracted"), {glob: false});
			result.tempFolderWasRemoved = true;
		}

		
		return result;
	}
}

module.exports = Installer;
