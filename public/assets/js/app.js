var rec; //Recorder.js object
var input; //MediaStreamAudioSourceNode we'll be recording
var recordTimeout, playbackTimeout;

var recorderSampleLength = 5000;
var sampleLength = recorderSampleLength;
var overlappingSamples = 6;
var outstandingRequests = 0;

$(document).ready(function() {
  $('#overlapping-samples').val(overlappingSamples);
  $('#overlapping-samples-val').html(overlappingSamples);
  $('#sample-length').val(sampleLength);
  $('#sample-length-val').html(sampleLength);
  $.get('/aggregates', handleSuccess);
})

// shim for AudioContext when it's not avb.
var AudioContext = window.AudioContext || window.webkitAudioContext;
var audioContext;
var destination;
var destinationChannel = 0;
var channelSplitter;
var channelMerger;
var audio = document.createElement('audio');

async function deviceLog() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  console.log('devices: ', devices);
  const audioDevices = devices.filter(device => device.kind === 'audiooutput');
  $('#playback-device-select').html(audioDevices.reduce((contents, device) => contents + `<option value="${device.deviceId}">${device.label.length > 0 ? device.label : device.deviceId}</option>`, ''));
  console.log(audio.sinkId);
  await audio.setSinkId(audioDevices[0].deviceId);
  console.log('Audio is being played on ' + audio.sinkId);
}

function updateOutstandingRequests(increment) {
  outstandingRequests += increment;
  $('#outstanding-requests').html(outstandingRequests);
}

function playNextSample() {
  var request = new XMLHttpRequest();
  request.open('GET', '/next_sample', true);
  request.responseType = 'arraybuffer';

  request.onload = function() {
    updateOutstandingRequests(+1);
    audioContext.decodeAudioData(request.response, function(buffer) {
      var source = audioContext.createBufferSource();
      source.buffer = buffer;
      var gainNode = audioContext.createGain();
      source.connect(gainNode);
      // gainNode.connect(audioContext.destination);
      gainNode.connect(channelSplitter);
      var currTime = audioContext.currentTime;
      gainNode.gain.linearRampToValueAtTime(0, currTime );
      gainNode.gain.linearRampToValueAtTime(1, currTime + sampleLength / 2000);
      gainNode.gain.linearRampToValueAtTime(0, currTime + sampleLength / 1000);
      var offset = 0;
      // would be better to calculate the length of buffer rather than assuming the returned file's length matches recordSampleLength
      var lengthDiff = recorderSampleLength - sampleLength;
      if (lengthDiff > 0) {
        offset = Math.random() * lengthDiff / 1000;
        console.log('offset: ' + offset);
      }
      source.start(0, offset);
    }, function() {console.log('error loading audio');});
  }

  request.send();
  updateOutstandingRequests(-1);

  playbackTimeout = window.setTimeout(function() {playNextSample();}, sampleLength / overlappingSamples);
}

function postSample() {
  if (recordTimeout && rec) {
    rec.exportWAV(function(blob) {
      var fd = new FormData();
      fd.append('audio_data', blob, Date.now() + '.wav');
      uploadFiles(fd);
    });
    rec.clear();
  }
  recordTimeout = window.setTimeout(postSample, recorderSampleLength);
}

/**
 * Upload the sample using ajax request.
 *
 * @param formData
 */
function uploadFiles(formData) {
    $.ajax({
        url: '/upload_sample',
        method: 'post',
        data: formData,
        processData: false,
        contentType: false,
        xhr: function () {
            var xhr = new XMLHttpRequest();

            // Add progress event listener to the upload.
            xhr.upload.addEventListener('progress', function (event) {
                var progressBar = $('.progress-bar');

                if (event.lengthComputable) {
                    var percent = (event.loaded / event.total) * 100;
                    progressBar.width(percent + '%');

                    if (percent === 100) {
                        progressBar.removeClass('active');
                    }
                }
            });

            return xhr;
        }
    }).done(handleSuccess).fail(function (xhr, status) {
        alert(status);
    });
}

/**
 * Handle the upload response data from server and display them.
 *
 * @param data
 */
function handleSuccess(data) {
    if (data) {
        var html = '';

        data.picks.forEach(function(pick, index) {
          html += '<p>' + pick.category.label;
          if (pick.file) {
            html += ' - ' + pick.file.filename;
          }
          html += '</p>';
        });

        html += '<ol>';
        for (var key in data.aggregates) {
          var item = data.aggregates[key];
          html += '<li><a href="#" class="category-label' + (item.suppressed ? ' suppressed' : '') + '" data-label-id="' + item.id + '">' + item.label + '</a>: ' + item.weight;// + ' <code>' + JSON.stringify(item.files) + '</code></li>';
        }
        html += '</ol>';
        $('#aggregates').html(html);


    } else {
        console.log('no data was returned');
    }
}

$('#start-record').on('click', function(event) {
  if (!audioContext) audioContext = new AudioContext;
  var constraints = { audio: true, video:false }
  navigator.mediaDevices.getUserMedia(constraints).then(function(stream) {
      console.log("getUserMedia() success, stream created, initializing Recorder.js ...");

      /* use the stream */
      input = audioContext.createMediaStreamSource(stream);

      /*
      Create the Recorder object and configure to record mono sound (1 channel)
      Recording 2 channels  will double the file size
      */
      rec = new Recorder(input,{numChannels:1})

      //start the recording process
      rec.record();

      postSample();

      $('#recording-status').show();

      deviceLog();

  }).catch(function(err) {
      console.log('getUserMedia() failed');
      //enable the record button if getUserMedia() fails
      // recordButton.disabled = false;
      // stopButton.disabled = true;
      // pauseButton.disabled = true
  });
});

$('#stop-record').on('click', function(event) {
  if (rec) {
    rec.stop();
  }
  if (recordTimeout) {
    window.clearTimeout(recordTimeout);
  }
  $('#recording-status').hide();
});

$('#reset').on('click', function(event) {
  $.post('/reset');
  $('#aggregates').empty();
});

$('#start-playback').on('click', function(event) {
  if (!audioContext) audioContext = new AudioContext;
  destination = audioContext.createMediaStreamDestination();
  channelSplitter = audioContext.createChannelSplitter(8);
  channelMerger = audioContext.createChannelMerger(8);
  channelSplitter.connect(channelMerger, 0, destinationChannel);
  channelMerger.connect(destination);
  audio.srcObject = destination.stream;
  audio.play();

  playNextSample();
  $('#playback-status').show();
});

$('#stop-playback').on('click', function(event) {
  if (playbackTimeout) {
    window.clearTimeout(playbackTimeout);
  }
  $('#playback-status').hide();
});

$('#playback-device-select').on('change', function(event) {
  var deviceId = event.target.value;
  if (deviceId) {
    audio.setSinkId(deviceId);
    console.log('changed playback device to: ', deviceId);
  }
});

$('#playback-channel').on('change', function(event) {
  var channel = event.target.value;
  if (channel > -1 && channel !== destinationChannel) {
    destinationChannel = channel;
    if (channelSplitter && channelMerger) {
      channelSplitter.disconnect();
      channelSplitter.connect(channelMerger, 0, destinationChannel);
    }
  }
});

$('#overlapping-samples').on('input', function(event) {
  var samples = event.target.value;
  if (samples > 0) {
    overlappingSamples = samples;
    $('#overlapping-samples-val').html(overlappingSamples);
  }
});

$('#sample-length').on('input', function(event) {
  var length = event.target.value;
  if (length > 100) {
    sampleLength = length;
    $('#sample-length-val').html(sampleLength);
  }
});

$('#aggregates').on('click', '.category-label', function() {
  $.post('/toggle_category', {label_id: $(this).data('label-id')}, handleSuccess);
});
