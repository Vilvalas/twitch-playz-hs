var express = require('express');
var app = express();
const fs = require('fs');
var http = require('http');
const https = require('https');
var socketIo = require('socket.io');

// Port 80 - HTTP default port
// var port = 80;

// Port 443 - HTTPS default port
var port = 443;

// HTTPS config
let options = {
    key  : fs.readFileSync('ssl/privkey.pem'),
    cert : fs.readFileSync('ssl/cert.pem')
};

// start webserver on port 443
var server = https.createServer(options, app);
server.listen(port);

// Listen on same port as server - since we use namespaces this is fine
var io = socketIo.listen(server);

console.log("Server running on port " + port);

// array of all users IP addresses, who added a line this turn
var currentIPs = [];

// array of all lines this turn
var currentLines = [];

// array of all users IP addresses, who added a line for next turn
var nextTurnIPs = [];

// array of all lines for next turn - these are not checked if valid!
var nextTurnLines = [];

var turnEnded = false;

var inputPhaseTimer;
var resolutionPhaseTimer;

var inputPhaseTimerTimeslot = 5000;
var resolutionPhaseTimerTimeslot = 1000;

var numberOfClients = 0;

var clientNamespace = io.of('/web-client');
var serverNamespace = io.of('/server-client');

var screenWidth = 1920;
var screenHeight = 1080;

var invalidInputs = [];
// Data structure: x1, y1, x2, y2
// Friend list
invalidInputs.push([6, 1036, 77, 1074]);

// Menu button
invalidInputs.push([1840, 1036, 1911, 1074]);

// Retire in Arena
invalidInputs.push([380, 964, 480, 1001]);

// Collection - Main Screen
// invalidInputs.push([869, 841, 1230, 984]);

// Collection - Play button
// invalidInputs.push([579, 957, 863, 1007]);

// Tavern Brawl - Create Deck
// invalidInputs.push([1366, 92, 1598, 191]);

// Crafting button in collection
invalidInputs.push([1158, 971, 1306, 1011]);

/* Default URL is delivered automatically
// Basic webserver delivering the client html file
app.get('/client', function(req,res) {
    res.sendFile(__dirname + '/client/index.html');
});
*/

/* Default namespace is used for client and server
io.on('connection', function(socket){
    console.log('New connection in default namespace');
});
*/

clientNamespace.on('connection', function(socket){
    numberOfClients++;
    // console.log('received new connection, active connections: ' + numberOfClients);

    socket.on('disconnect', function(){
        // console.log('event handler triggered: disconnect');
        numberOfClients--;
    });

    // add handler for message type "draw_line".
    socket.on('userInput', function (data) {
        // Get the clients IP address and check if we already received from him this input turn
        var ipAddress = socket.request.connection.remoteAddress;
        // console.log("Received input from: " + ipAddress);

        if(turnEnded) {
            if (!nextTurnIPs.includes(ipAddress)) {
                nextTurnIPs.push(ipAddress);
                // Next turn lines are checked later on if valid
                nextTurnLines.push(data.line);
            }
        } else {
            if (!currentIPs.includes(ipAddress)) {
                currentIPs.push(ipAddress);

                convertToPixelValues(data.line);

                if(checkIfLineValid(data.line)) {
                    // Line is valid - Add received line to current lines
                    currentLines.push(data.line);
                    // Send to server-client to draw the line
                    serverNamespace.emit('line',{
                        numberOfClients: numberOfClients,
                        line: {
                            x1: data.line[0],
                            y1: data.line[1],
                            x2: data.line[2],
                            y2: data.line[3],
                            circle: data.line[4]
                        }
                    });
                } else {
                    serverNamespace.emit('invalid_line',{
                        numberOfClients: numberOfClients,
                        line: {
                            x1: data.line[0],
                            y1: data.line[1],
                            x2: data.line[2],
                            y2: data.line[3],
                            circle: data.line[4]
                        }
                    });
                }
            }
            else {
                // do nothing / discard request
            }
        }
    });
});

// start the server once everything is loaded
startNewInputTurn();

function startNewInputTurn() {
    turnEnded = false;
    inputPhaseTimer = setTimeout(endInputTurn, inputPhaseTimerTimeslot);
    // Send to server-client
    serverNamespace.emit('new_input_turn',{
        numberOfClients: numberOfClients
    });

    // Evaluate the lines that passed in during the resolution phase
    for (var j = 0; j < nextTurnIPs.length; j++) {
        currentIPs.push(nextTurnIPs[j]);
    }

    // Convert nextTurnLines into the next turn, but only if they are valid
    for (var i = 0; i < nextTurnLines.length; i++) {
        convertToPixelValues(nextTurnLines[i]);

        if(checkIfLineValid(nextTurnLines[i])) {
            // Line is valid - Add received line to current lines
            currentLines.push(nextTurnLines[i]);
            // Send to server-client to draw the line
            serverNamespace.emit('line',{
                numberOfClients: numberOfClients,
                line: {
                    x1: nextTurnLines[i][0],
                    y1: nextTurnLines[i][1],
                    x2: nextTurnLines[i][2],
                    y2: nextTurnLines[i][3],
                    circle: nextTurnLines[i][4]
                }
            });
        } else {
            serverNamespace.emit('invalid_line',{
                numberOfClients: numberOfClients,
                line: {
                    x1: nextTurnLines[i][0],
                    y1: nextTurnLines[i][1],
                    x2: nextTurnLines[i][2],
                    y2: nextTurnLines[i][3],
                    circle: nextTurnLines[i][4]
                }
            });
        }
    }

    // clean up variables for next turn
    nextTurnIPs = [];
    nextTurnLines = [];
}

function endInputTurn() {
    turnEnded = true;
    var winnerLine;
    var bestScoreSoFar = 2147483640;

    /* Old implementation which mostly selects lines in the middle
    // calculate average line
    var totalStartX = 0;
    var totalStartY = 0;
    var totalEndX = 0;
    var totalEndY = 0;

    for (var i = 0; i < currentLines.length; i++) {
        totalStartX += currentLines[i][0];
        totalStartY += currentLines[i][1];
        totalEndX += currentLines[i][2];
        totalEndY += currentLines[i][3];
    }

    var averageStartX = totalStartX / currentLines.length;
    var averageStartY = totalStartY / currentLines.length;
    var averageEndX = totalEndX / currentLines.length;
    var averageEndY = totalEndY / currentLines.length;

    // compare the average line to all lines to find the best fitting line
    // lowest lineScore wins
    for (var j = 0; j < currentLines.length; j++) {
        var lineScore = 0;

        lineScore += Math.abs(averageStartX - currentLines[j][0]);
        lineScore += Math.abs(averageStartY - currentLines[j][1]);
        lineScore += Math.abs(averageEndX - currentLines[j][2]);
        lineScore += Math.abs(averageEndY - currentLines[j][3]);

        if(lineScore < bestScoreSoFar) {
            winnerLine = currentLines[j];
            bestScoreSoFar = lineScore;
        }
    }
    */

    // Compare each line to all other lines, to find the best fitting line
    // To give more weight to clusters we take the power of 2
    // Lowest lineScore wins
    for (var i = 0; i < currentLines.length; i++) {
        // Score for this line (indicated by i)
        var lineScore = 0;

        for (var j = 0; j < currentLines.length; j++) {
            lineScore += Math.pow(Math.abs(currentLines[i][0] - currentLines[j][0]), 2);
            lineScore += Math.pow(Math.abs(currentLines[i][1] - currentLines[j][1]), 2);
            lineScore += Math.pow(Math.abs(currentLines[i][2] - currentLines[j][2]), 2);
            lineScore += Math.pow(Math.abs(currentLines[i][3] - currentLines[j][3]), 2);
        }

        if(lineScore < bestScoreSoFar) {
            winnerLine = currentLines[i];
            bestScoreSoFar = lineScore;
        }
    }

    // Check if winnerLine is set (if there was at least one line drawn)
    if(winnerLine) {
        // Send winner line to server-client with special event
        serverNamespace.emit('winner_line',{
            numberOfClients: numberOfClients,
            line: {
                x1: winnerLine[0],
                y1: winnerLine[1],
                x2: winnerLine[2],
                y2: winnerLine[3],
                circle: winnerLine[4]
            }
        });
    }

    // clean up variables for next turn
    currentIPs = [];
    currentLines = [];

    // wait one second and start a new input turn
    resolutionPhaseTimer = setTimeout(startNewInputTurn, resolutionPhaseTimerTimeslot);
}

function convertToPixelValues(line) {
    // Convert relative coordinates to pixels
    line[0] = Math.round(line[0] * screenWidth);
    line[1] = Math.round(line[1] * screenHeight);
    line[2] = Math.round(line[2] * screenWidth);
    line[3] = Math.round(line[3] * screenHeight);
}

function checkIfLineValid(line) {
    // check if line is valid - check coordinates
    for (var i = 0; i < invalidInputs.length; i++) {
        // We only care about the end point of the line
        if(line[2] >= invalidInputs[i][0] && line[2] <= invalidInputs[i][2] && line[3] >= invalidInputs[i][1] && line[3] <= invalidInputs[i][3]){
            return false;
        }
    }
    return true;
}