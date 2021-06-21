var express = require('express'),
    path = require('path'),
    fs = require('fs'),
    formidable = require('formidable'),
    readChunk = require('read-chunk'),
    fileType = require('file-type'),
    request = require('request'),
    bodyParser = require('body-parser');


var app = express();

var aggregates = [],
  picks = [],
  counter = 0;

var aggregatesLimit = 15;
var pickCount = 2;

app.set('port', (process.env.PORT || 4000));

// Tell express to serve static files from the following directories
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));
app.use(bodyParser.urlencoded({
  extended: true
}));
app.use(bodyParser.json());

function choosePicks() {
  picks = [];
  var aggregatesTable = [];
  aggregates.forEach(function(aggregate, index) {
    if (!aggregate.suppressed) {
      var weight = aggregate.weight * 100;
      for (var j = 0; j < weight; j++) {
        aggregatesTable.push(index);
      }
    }
  });
  for (var i = 0; i < pickCount; i++) {
    var aggregateIndex = aggregatesTable[Math.floor(Math.random() * aggregatesTable.length)];
    console.log(aggregateIndex);
    var selectedAggregate = aggregates[aggregateIndex];
    var filesTable = [];
    selectedAggregate.files.forEach(function(file, index) {
      var weight = file.probability * 100;
      for (var k = 0; k < weight; k++) {
        filesTable.push(index);
      }
    });
    var fileIndex = filesTable[Math.floor(Math.random() * filesTable.length)];
    var selectedFile = selectedAggregate.files[fileIndex];
    picks.push({category: selectedAggregate, file: selectedFile});
  }
}

/**
 * Index route
 */
app.get('/', function (req, res) {
    // Don't bother about this :)
    var filesPath = path.join(__dirname, 'uploads/');
    fs.readdir(filesPath, function (err, files) {
        if (err) {
            console.log(err);
            return;
        }

        files.forEach(function (file) {
            fs.stat(filesPath + file, function (err, stats) {
                if (err) {
                    console.log(err);
                    return;
                }

                var createdAt = Date.parse(stats.ctime),
                    days = Math.round((Date.now() - createdAt) / (1000*60*60*24));

                if (days > 1) {
                    fs.unlink(filesPath + file, function() {});
                }
            });
        });
    });

    res.sendFile(path.join(__dirname, 'views/index.html'));
});

app.get('/next_sample', function(req, res) {
  var pathname = 'public/assets/audio/silence.wav';
  if (picks.length < 1) {
    choosePicks();
  }
  if (picks.length > 0) {
    var pick = picks.shift();
    console.log("Picked sample:", pick.category.label, pick.file.filename);
    pathname = 'uploads/' + pick.file.filename;
  }
  res.sendFile(path.join(__dirname, pathname));
});

app.post('/toggle_category', function(req, res) {
  console.log(req.body);
  var id = req.body['label_id'];
  console.log('toggle suppressed:', id);
  if (id) {
    for (var i = 0; i < aggregates.length; i++) {
      var aggregate = aggregates[i];
      if (aggregate.id === id) {
        aggregate.suppressed = !aggregate.suppressed
        break;
      }
    }
  }
  res.status(200).json({aggregates: aggregates, picks: picks});
});

app.post('/reset', function(req, res) {
  aggregates = [];
  picks = [];
  counter = 0;

  var filesPath = path.join(__dirname, 'uploads/');
  fs.readdir(filesPath, function (err, files) {
      if (err) {
          console.log(err);
          return;
      }

      files.forEach(function (file) {
          fs.stat(filesPath + file, function (err, stats) {
              if (err) {
                  console.log(err);
                  return;
              }
              fs.unlink(filesPath + file, function() {});
          });
      });
  });

  res.status(200);
});

/**
 * Upload sample route.
 */
app.post('/upload_sample', function (req, res) {
    var form = new formidable.IncomingForm();
    var latest = [];

    // Upload directory for the files
    form.uploadDir = path.join(__dirname, 'tmp_uploads');

    // Invoked when a file has finished uploading.
    form.on('file', function (name, file) {
        var buffer = null,
            type = null,
            filename = '';

        // Read a chunk of the file.
        buffer = readChunk.sync(file.path, 0, 262);
        // Get the file type using the buffer read using read-chunk
        type = fileType(buffer);

        // Check the file type, must be wav
        if (type !== null && (type.ext === 'wav')) {
            // Assign new file name
            filename = file.name;

            // Move the file with the new file name
            fs.rename(file.path, path.join(__dirname, 'uploads/' + filename), function() {
              // send it to the classifier
              request.post({url: 'http://localhost:5000/model/predict', formData: {
                audio: fs.createReadStream('uploads/' + filename)
              }}, function(err, res) {
                if (err) console.log(err);
                if (res && res.body) {
                  counter++;
                  var predictions = latest = JSON.parse(res.body)['predictions'];
                  console.log('predictions: ', predictions);
                  if (predictions && predictions.length > 0) {
                    var predictionIds = [];
                    aggregates.forEach(function(category, index) {
                      predictionIds = predictions.map(function(prediction) {
                        return prediction['label_id'];
                      });
                      var addition = 0;
                      var id = category.id;
                      var incomingIndex = predictionIds.indexOf(id);
                      if (incomingIndex >= 0) {
                        var prediction = predictions.splice(incomingIndex, 1)[0];
                        addition = prediction['probability'];
                        var fileIndex = 0;
                        while(fileIndex < category.files.length && addition < category.files[fileIndex].probability)
                          fileIndex++;
                        category.files.splice(fileIndex, 0, {filename: filename, probability: addition});
                      }
                      aggregates[index].weight = (category.weight * (counter - 1) + addition) / counter;
                    });
                    // add new entries for the incoming predictions whose labels weren't already represented
                    predictions.forEach(function(prediction) {
                      aggregates.push({
                        id: prediction['label_id'],
                        label: prediction['label'],
                        weight: prediction['probability'] / counter, // -- give new sounds a chance to gain a hold in the list (in a crude way, here)
                        files: [{filename: filename, probability: prediction['probability']}],
                        suppressed: false
                      });
                    });
                    aggregates.sort(function(a, b) {
                      return b.weight - a.weight;
                    });
                    var aggregatesLength = aggregates.length;
                    if (aggregatesLength > aggregatesLimit)
                      aggregates.splice(aggregatesLimit, aggregatesLength - aggregatesLimit);
                  }

                  choosePicks();
                }
              });
            });

        } else {
            // photos.push({
            //     status: false,
            //     filename: file.name,
            //     message: 'Invalid file type'
            // });
            fs.unlink(file.path, function() {});
        }
    });

    form.on('error', function(err) {
        console.log('Error occurred during processing - ' + err);
    });

    // Invoked when all the fields have been processed.
    form.on('end', function() {
        // console.log('All the request fields have been processed.');
    });

    // Parse the incoming form fields.
    form.parse(req, function (err, fields, files) {
        res.status(200).json({aggregates: aggregates, picks: picks});
    });
});

app.get('/aggregates', function(req, res) {
  res.status(200).json({aggregates: aggregates, picks: picks});
});

app.listen(app.get('port'), function() {
    console.log('Express started at port ' + app.get('port'));
});
