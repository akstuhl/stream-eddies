# Stream Eddies

_Stream eddies_ is a granular sound regurgitator that uses a [machine learning audio classifier](https://github.com/IBM/MAX-Audio-Classifier) to sort and select samples. Similarly to other granular effects like [Clouds/Beads](https://mutable-instruments.net/modules/beads/) and [streamStretch~](https://github.com/wbrent/streamStretch_tilde), this process is intended to take an ongoing but non-uniform source signal and give it a somewhat denser consistency. Streameddies works by chopping the incoming sound into 5-second samples, running the classifier on each sample, and then semi-randomly choosing samples to play back based on the classification values it has received most so far. For example, if after 2 minutes of input the classifier has returned "trombone" more often than any other label, the sample that plays back most frequently will be the one that has been most trombone-like according to the algorithm.

## Install

First, set up the classifier (see "Run Locally" steps in the [classifier readme](https://github.com/IBM/MAX-Audio-Classifier#run-locally)):

```
$ git clone https://github.com/IBM/MAX-Audio-Classifier.git
$ cd MAX-Audio-Classifier
$ docker build -t max-audio-classifier .
$ docker run -it -p 5000:5000 max-audio-classifier
```

Then (in a new command line window), install _stream eddies_:

```
$ git clone https://github.com/akstuhl/stream-eddies.git
$ cd stream-eddies
$ npm install
$ node index.js
```

In your browser, go to [localhost:4000](http://localhost:4000)
