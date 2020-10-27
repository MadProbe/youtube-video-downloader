# Youtube Video Downloader

This downloader can download youtube videos with resolution greatest possible resolution 
(limited to 1080p for perfomance reasons).

## Installation

1. Make sure that you installed `node` >= 14.13.0, `ffmpeg` and `git` .
2. Clone this repository by `git clone https://github.com/MadProbe/youtube-video-downloader.git` .
3. Open your command prompt in cloned folder and install all required modules by `npm i` .

## Usage

 `node index.mjs <video-url> <...options>`

### CLI Options:

* `--help` | `-h` : Prints a help message
* `--re-encode` : By default input video file is not re-encoded because this greatly degrades download speed, does not affect if video already has an audio thread (typically, videos with resultion greater than 720p doesn't contain an audio thread, so you need to merge a video and audio thread to give video sound).
