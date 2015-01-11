#!/usr/bin/env node
var connect = require('connect'),
	colors = require('colors'),
	WebSocket = require('faye-websocket'),
	path = require('path'),
	url = require('url'),
	http = require('http'),
	send = require('send'),
	open = require('open'),
	watchr = require('watchr'),
	ws;

var INJECTED_CODE = require('fs').readFileSync(__dirname + "/injected.html", "utf8");

var LiveServer = {};

function escape(html){
	return String(html)
		.replace(/&(?!\w+;)/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

// Shallow extend function
function extend(target, source) {
	for (var k in source) {
		if (source.hasOwnProperty(k)) {
			target[k] = source[k];
		}
	}
	return target;
}

// Based on connect.static(), but streamlined and with added code injecter
function staticServer(root) {
	return function(req, res, next) {
		if ('GET' != req.method && 'HEAD' != req.method) return next();
		var reqpath = url.parse(req.url).pathname;

		function directory() {
			var pathname = url.parse(req.originalUrl).pathname;
			res.statusCode = 301;
			res.setHeader('Location', pathname + '/');
			res.end('Redirecting to ' + escape(pathname) + '/');
		}

		function error(err) {
			if (404 == err.status) return next();
			next(err);
		}

		function inject(stream) {
			var x = path.extname(reqpath);
			if (x === "" || x == ".html" || x == ".htm" || x == ".xhtml" || x == ".php") {
				// We need to modify the length given to browser
				var len = INJECTED_CODE.length + res.getHeader('Content-Length');
				res.setHeader('Content-Length', len);
				// Write the injected code
				res.write(INJECTED_CODE);
			}
		}

		send(req, reqpath, { root: root })
			.on('error', error)
			.on('stream', inject)
			.on('directory', directory)
			.pipe(res);
	};
}

/**
 * Start a live server at the given port, directory, and host
 * @param port {number} Port number (default 8080)
 * @param directory {string} Path to root directory (default to cwd)
 * @param suppressBrowserLaunch
 * @param host {string} Host (default 'localhost')
 * Or
 * @param port {object} Config object defining above
 */
LiveServer.start = function(port, directory, suppressBrowserLaunch, host) {
	var opts, defaults = {
		host: 'localhost',
		port: 8080,
		directory: process.cwd(),
		suppressBrowserLaunch: false
	};

	// if first arg is an object, use as a config object
	if (typeof port === 'object') opts = extend(defaults, port);
	else {
		var args = {};

		if (host) args.host = host;
		if (port) args.port = port;
		if (directory) args.directory = directory;

		if (suppressBrowserLaunch !== undefined)
			args.suppressBrowserLaunch = suppressBrowserLaunch;

		opts = extend(defaults, args);
	}

	// Setup a web server
	var app = connect()
		.use(staticServer(opts.directory)) // Custom static server
		.use(connect.directory(opts.directory, { icons: true }))
		.use(connect.logger('dev'));
	var server = http.createServer(app).listen(opts.port, opts.host);
	// WebSocket
	server.addListener('upgrade', function(request, socket, head) {
		ws = new WebSocket(request, socket, head);
		ws.onopen = function() { ws.send('connected'); };
	});
	// Setup file watcher
	watchr.watch({
		path: opts.directory,
		ignoreCommonPatterns: true,
		ignoreHiddenFiles: true,
		preferredMethods: [ 'watchFile', 'watch' ],
		interval: 1407,
		listeners: {
			error: function(err) {
				console.log("ERROR:".red , err);
			},
			change: function(eventName, filePath, fileCurrentStat, filePreviousStat) {
				if (!ws) return;
				if (path.extname(filePath) == ".css") {
					ws.send('refreshcss');
					console.log("CSS change detected".magenta);
				} else {
					ws.send('reload');
					console.log("File change detected".cyan);
				}
			}
		}
	});
	// Output
	console.log(([
		'Serving "', opts.directory,
		'" at http://', opts.host, ':', opts.port
	].join('')).green);

	// Launch browser
	if(!suppressBrowserLaunch)
		open('http://' + opts.host + ':' + opts.port);
};

module.exports = LiveServer;

