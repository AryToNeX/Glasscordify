/*
   Copyright 2020 AryToNeX

   Licensed under the Apache License, Version 2.0 (the 'License');
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an 'AS IS' BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
*/
'use strict';

const inquirer = require("inquirer");
const lib = require("glasscordify-lib");

// console.warn("This is a work in progress; many features will be broken or missing. Proceed with caution.");

var ansi = {
	reset: "\x1b[0m",
	black: "\x1b[30m",
	red: "\x1b[31m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	blue: "\x1b[34m",
	magenta: "\x1b[35m",
	cyan: "\x1b[36m",
	white: "\x1b[37m",
}
console.log(ansi.cyan + "== " + ansi.magenta + "Glasscord Installer " + ansi.cyan + "==" + ansi.reset + "\n");

let app;

var questions = [
	{
		type: "list",
		name: "mode",
		message: "Select an option:",
		choices: [
			"Install",
			"Uninstall"
		]
	},
	{
		type: "input",
		name: "appPath",
		message: "Enter the path to the executable you would like to install Glasscord into:",
		validate: checkApp,
		when: function(answers){
			return answers.mode == "Install";
		}
	},
	{
		type: "input",
		name: "appPath",
		message: "Enter the path to the executable you would like to remove Glasscord from:",
		validate: checkApp,
		when: function(answers){
			return answers.mode == "Uninstall";
		}
	}
];

inquirer.prompt(questions).then(answers => {
	if (answers.mode == "Install") install(answers.appPath);
	else if (answers.mode == "Uninstall") uninstall(answers.appPath);
	else console.log("Uh oh, something went wrong! Please try again.");
});


async function checkApp(appPath, answers){
	var executableFile = await lib.Utils.getAbsoluteExecutableFile(appPath);
	if(typeof executableFile === "undefined"){
		return "error", "Given file is not valid!";
	}
	
	app = lib.Installer.checkApp(executableFile);
	if (app.error) return app.error;
	if (answers.mode == "Install" && app.isPatched) return "App is already patched!";
	if (answers.mode == "Uninstall" && !app.isPatched) return "App is not patched!";
	return true;
}

async function install(){
	if (!lib.Utils.isGlasscordDownloaded()){
		console.log("Downloading package...");
		var result = await lib.Utils.downloadGlasscordAsar();
		if (result){
			console.log("Download successful.");
		} else {
			console.log(ansi.red + "Download failed! " + ansi.reset + "Please check your internet connection and try again.");
			return false;
		}
	}
	
	result = lib.Installer.install(app);
	if(result.error) console.error(result.error);
	
	if(app.appPathType === "asar"){ // we worked in our temp dir!
		lib.Utils.moveAsarToBackupFolder(app.resourcesPath);
		lib.Utils.commitAsarExtraction(app.resourcesPath);
	}
	
	console.log(ansi.green + "Install completed! " + ansi.reset + "Restart the app and install a compatible stylesheet to see Glasscord work.");
}

function uninstall(){
	console.log(`Uninstalling Glasscord...`);
}
