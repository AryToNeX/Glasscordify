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

const electron = require("electron");
const glasstron = require("glasstron");
const exec = require("child_process").execSync;
const path = require("path");
const lib = require("./lib_interface.js");

electron.app.commandLine.appendSwitch("enable-transparent-visuals");

// Check if an instance is already running
if (!electron.app.requestSingleInstanceLock()){
	electron.app.quit();
}

var win;

electron.app.allowRendererProcessReuse = true;

electron.app.on("ready", (e) => setTimeout(createWindow, process.platform === "linux" ? 1000 : 0));

electron.app.on('activate', () => {
	if(electron.BrowserWindow.getAllWindows().length === 0)
		setTimeout(createWindow, process.platform === "linux" ? 1000 : 0);
	else
		electron.BrowserWindow.getAllWindows()[0].show();
});

electron.app.on('second-instance', (e, commandLine, workingDirectory) => {
	// Someone tried to run a second instance, we should focus our window.
	if (win){
		if (win.isMinimized()) win.restore();
		win.show();
		win.focus();
	}
});

function createWindow(){
	win = new glasstron.BrowserWindow({
		width: 1280,
		height: 720,
		center: true,
		resizable: false,
		frame: false,
		fullscreenable: false,
		maximizable: false,
		title: "Glasscordify",
		show: true,
		backgroundColor: "#A0FFFFFF",
		icon: getIcon(),
		blurType: "blurbehind",
		vibrancy: "fullscreen-ui",
		blur: true,
		webPreferences: {
			enableRemoteModule: false,
			nodeIntegration: true
		}
	});

	win.webContents.on('new-window', function(e, url){
		e.preventDefault();
		openExternal(url);
	});
	
	win.webContents.on('will-navigate', function(e, url){
		e.preventDefault();
		openExternal(url);
	});

	// events
	electron.ipcMain.on("close", () => win.close());
	electron.ipcMain.on("minimize", () => win.minimize());
	electron.ipcMain.on("install-clicked", () => lib.installClicked(win));
	electron.ipcMain.on("uninstall-clicked", () => lib.uninstallClicked(win));
	electron.ipcMain.on("install-drop", (e,files) => lib.installDrop(win, files));
	electron.ipcMain.on("uninstall-drop", (e,files) => lib.uninstallDrop(win, files));
	electron.ipcMain.on("restart", () => {
		electron.app.quit();
		electron.app.relaunch();
	});

	win.loadURL("file://" + __dirname + "/resources/index.html");
	electron.ipcMain.on("ready", () => lib.init(win));
}

function getIcon(){
	switch(process.platform){
		case "linux": return path.resolve(__dirname, "icon/icon.png");
		case "darwin": return path.resolve(__dirname, "icon/icon.icns");
		case "win32": return path.resolve(__dirname, "icon/icon.ico");
	}
	return undefined;
}

function openExternal(url){
	const cmd = () => {switch(process.platform){
		case "win32": return "start " + url;
		case "darwin": return "open " + url;
		case "linux": return "xdg-open " + url;
	}};
	return exec(cmd());
}
