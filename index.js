var d3 = require('d3');
var _ = require('tny');

function fn(name, fn) {
  var v, params = Array.prototype.slice.call(arguments, 2);
  return function (o) {
    var val = (typeof (v = o[name]) === 'function' ? v.apply(o, params) : v);
    return fn !== undefined ? fn(val) : val;
  };
}

function secondsTimeSpanToMS(s) {
  var h = Math.floor(s / 3600);
  s -= h * 3600;
  var m = Math.floor(s / 60);
  s = Math.round(s - m * 60);
  return (m < 10 ? '0' + m : '' + m) + ":" + (s < 10 ? '0' + s : '' + s);
}

var Waveform = (function () {
  "use strict";

  function Waveform(pubsubService, data, viz) {
    var _this = this;
    this.pubsubService = pubsubService;
    this.data = data;
    this.seekLineWidth = 4;
    this.container = viz.el;
    this.config = viz.config;
    this.setConfig(viz.config);
    this.durationText = secondsTimeSpanToMS(data.duration);
    this.highlightZones = {};
    this.onSeek = pubsubService.publish.bind(pubsubService, 'waveform.click', viz.track);

    this.pubsubHandles = [
      pubsubService.subscribe('player.playing', function (track, playData) {
        if (!track || !track.id || !data || !data.id) {
          return;
        }
        var imPlaying = track.id === data.id;

        if (imPlaying !== _this.playing) {
          _this.playing = imPlaying;
          if (imPlaying) {
            if (!_this.playerEventsOn()) {
              _this.redraw(true);
              _this.update(0, 1);
            }
          } else {
            if (_this.playerEventsOff()) {
              // events were on, best redraw the waveform
              _this.redraw();
            }
          }
        }
      }),
      pubsubService.subscribe('player.stop', function () {
        _this.playing = false;
        if (_this.playerEventsOff()) {
          _this.redraw();
        }
      })
    ];

    this.redraw();
  }

  Waveform.prototype.playerEventsOff = function () {
    var eventsOn = !!this.playerListeners;
    if (eventsOn) {
      var handle;
      while (handle = this.playerListeners.pop()) {
        this.pubsubService.unsubscribe(handle);
      }
      this.playerListeners = null;
      this.detachPlayer();
    }
    return eventsOn;
  };

  Waveform.prototype.playerEventsOn = function () {
    var _this = this;
    var eventsOn = !!this.playerListeners;
    if (!eventsOn) {
      var playerEvents = {
        'player.playing': function (track, playerData) {
          _this.playing = playerData.playing;
          _this.positionLine.attr("x", _this.tx(playerData.currentTime));

          //if (this.config.textOverlay > 0) {
          //this.timeLayer.text(secondsTimeSpanToMS(playerData.currentTime) + " / " + this.durationText);
          //	}
          var b0 = playerData.buffered, startx = 0, endx = _this.ax.invert(_this.tx(b0));

          _this.update(startx, endx);
        },
        'player.pause': function () {
          _this.playing = false;
          _this.updateMessage('Paused...', 1000);
        }
      };

      this.playerListeners = _.map(playerEvents, function (v, k) {
        return _this.pubsubService.subscribe(k, v);
      });
      this.attachPlayer();
    }
    return eventsOn;
  };

  Waveform.prototype.attachPlayer = function () {
    this.container.mouseleave(this.onMouseOutGraph.bind(this));
    this.container.mousemove(this.onMouseOverGraph.bind(this));
    this.container.mouseup(this.onMouseUp.bind(this));
    this.container.mousedown(this.onMouseDown.bind(this));
    this.redraw();
  };

  Waveform.prototype.detachPlayer = function () {
    this.container.unbind('mouseleave');
    this.container.unbind('mousemove');
    this.container.unbind('mouseup');
    this.container.unbind('mousedown');
    this.redraw();
  };

  Waveform.prototype.dispose = function () {
    var _this = this;
    this.playerEventsOff();
    angular.forEach(this.pubsubHandles, function (handle) {
      _this.pubsubService.unsubscribe(handle);
    });
  };

  Waveform.prototype.onMouseUp = function (event) {
    var minZoneSize = 5;
    if (this.userMouseOverAction === 1) {
      this.onSeek(this.tx.invert(this.currentUserPositionX));
    } else if (this.userMouseOverAction === 2 && this.playing && this.zoneTemp) {
      if (this.zoneTemp.end > this.zoneTemp.start + minZoneSize) {
        var key = new Date().getTime();
        this.zoneTemp.startTime = this.tx.invert(this.zoneTemp.start);
        this.zoneTemp.endTime = this.tx.invert(this.zoneTemp.end);
        this.highlightZones[key] = this.zoneTemp;
        this.zoneTemp = null;
        this.redrawZones();
      }
    }
  };

  Waveform.prototype.onMouseDown = function (event) {

  };

  Waveform.prototype.onMouseOverGraph = function (event) {
    var mouseX = event.pageX - this.seekLineXOffset, mouseY = event.pageY - this.seekLineYOffset, inXRange = mouseX >= 0 && mouseX <= this.w;

    if (inXRange && mouseY >= this.waveformAreaHeight && mouseY <= this.h) {
      if (this.seekLine) {
        this.seekLine.classed("hide", false);
        this.seekLine.attr("x", mouseX - (this.seekLineWidth / 2)); //.attr("x2", mouseX + seekLineWidth);
      }
      this.userMouseOverAction = 1;
      this.currentUserPositionX = mouseX;
    } else if (inXRange && mouseY >= 0 && mouseY < this.waveformAreaHeight) {
      this.userMouseOverAction = 2;
      this.currentUserPositionX = mouseX;
      if (this.zoneTemp) {
        var minOfZones = Number.MAX_VALUE, k, v;
        for (k in this.highlightZones) {
          v = this.highlightZones[k];
          if (v && v.start && v.start < minOfZones && v.start > this.zoneTemp.start) {
            minOfZones = v.start;
          }
        }
        this.zoneTemp.end = Math.max(this.zoneTemp.start, Math.min(mouseX, minOfZones));
        this.redrawActiveZone();
      }
    } else {
      this.onMouseOutGraph(event);
    }
  };

  Waveform.prototype.onMouseOutGraph = function (event) {
    if (this.seekLine) {
      this.seekLine.classed("hide", true);
    }
    this.zoneTemp = null;
    this.redrawActiveZone();
    this.userMouseOverAction = 0;
    this.currentUserPositionX = -1;
  };

  Waveform.prototype.reconfigure = function (config) {
    this.setConfig(config);
    this.redraw();
  };

  Waveform.prototype.setConfig = function (config) {
    config = angular.extend({
      detail: 5,
      centreBias: 0.5,
      padding: 0,
      heightPercent: 10,
      height: 0,
      controls: false,
      highlightMode: false,
      textOverlay: 10
    }, config);
    this.config = {
      padding: parseInt(config.padding || 0, 0),
      centreBias: parseFloat(config.centreBias || 0.5),
      heightPercent: parseInt(config.heightPercent || 10, 10),
      height: parseInt(config.height || 0, 10),
      controls: !!config.controls,
      textOverlay: parseInt(config.textOverlay || 1, 10),
      highlightMode: !!config.highlightMode
    };
  };

  Waveform.prototype.redrawActiveZone = function () {
    if (!this.zoneTemp && this.zoneRect) {
      // destroy
      return;
    }
    if (this.zoneTemp && this.zoneTemp.start && this.zoneTemp.end) {
      if (!this.zoneRect) {
        this.zoneRect = this.zonesGroup.append('rect');
        this.zoneRect.attr('y', 0).attr('height', this.waveformAreaHeight);
      }
      this.zoneRect.attr('class', 'highlight-zone active').attr('x', this.zoneTemp.start).attr('width', this.zoneTemp.end - this.zoneTemp.start);
    }
  };

  Waveform.prototype.redrawZones = function () {
    var k, v;

    for (k in this.highlightZones) {
      v = this.highlightZones[k];
      this.zonesGroup.append('rect').attr('y', 0).attr('height', this.waveformAreaHeight).attr('class', 'highlight-zone').attr('x', v.start).attr('width', v.end - v.start);
    }
  };

  Waveform.prototype.updateMessage = function (msg, timeout) {
    var _this = this;
    if (typeof timeout === "undefined") {
      timeout = 1000;
    }
    if (this.config.textOverlay <= 0) {
      return;
    }
    var t;
    if (t) {
      clearTimeout(t);
    }
    if (!msg) {
      this.messageLayer.text("");
    } else {
      this.messageLayer.text(msg);
      if (timeout) {
        t = setTimeout(function () {
          _this.updateMessage();
        }, timeout);
      }
    }
    this.currentMessage = msg;
  };

  Waveform.prototype.processData = function (samples, duration, maxPoints) {
    var sampleLen = samples.length, b0 = this.config.centreBias, b1 = 1 - b0, step = maxPoints && sampleLen > maxPoints ? Math.round(sampleLen / maxPoints) : 1, dstep = (duration / sampleLen) * step;

    var data = d3.range(0, sampleLen, step).map(function (i) {
      var s = samples[i] || 0;
      return s.length === 2 ? { t: dstep * i, y0: s[0] * b0, y1: -s[1] * b1 } : { t: dstep * i, y0: s * b0, y1: (s ? -s : s) * b1 };
    });

    this.fnk = function (d) {
      return d.t;
    };

    this.tx = d3.scale.linear().domain([0, duration]);

    this.ax = d3.scale.linear().domain([0, data.length]);

    this.ay = d3.scale.linear().domain([
      d3.min(data, fn('y1')),
      d3.max(data, fn('y0'))
    ]);

    return data;
  };

  Waveform.prototype.redraw = function (force) {
    var _this = this;
    var playing = force || this.playing;
    var c = this.container;

    c.empty();

    var w = this.w = c.width(), h = this.h = this.config.height > 0 ? this.config.height : (w / this.config.heightPercent);

    this.channelData = this.processData(this.data.peaks || this.data.samples, this.data.duration, w);

    // recalc the min height that the mouse tracks mouse
    this.waveformAreaHeight = this.config.highlightMode ? this.h : 0;

    this.seekLineXOffset = c.offset().left;
    this.seekLineYOffset = c.offset().top;
    this.tx.range([this.config.padding, w - this.config.padding]);
    this.ax.range([this.config.padding, w - this.config.padding]);
    this.ay.range([h, 0]);

    this.area = d3.svg.area().interpolate("step-after").x(function (d, i) {
      return _this.ax(i);
    }).y0(fn('y0', this.ay)).y1(fn('y1', this.ay));

    var bufferClass = "buffered-area";

    var svg = d3.select(c[0]).append("svg").attr('width', '100%').attr('height', h);

    if (playing) {
      var mask = svg.append("svg:g").append("path").attr("class", "mask-area").attr("d", this.area(this.channelData));
      bufferClass += ' playing';
    }

    this.buffered = svg.append("svg:g").append('path');

    this.buffered.attr('d', this.area(this.channelData)).attr("class", bufferClass);

    if (this.config.textOverlay > 0) {
      var textGroup = svg.append("svg:g");

      this.messageLayer = textGroup.append("svg:text");

      this.messageLayer.attr('x', w / 2).attr('y', h / 2).attr('class', 'status-message').text(this.currentMessage || "");
    }

    if (this.config.highlightMode) {
      this.zonesGroup = svg.append("svg:g");
      this.redrawZones();
    }

    if (playing) {
      var lh = h, ly = this.config.highlightMode ? h - lh : 0;

      this.seekLine = svg.append("rect").attr("class", "hover-line").attr("x", 0 - (this.seekLineWidth / 2)).attr("width", this.seekLineWidth).attr("y", ly).attr("height", lh); // top to bottom

      this.seekLine.classed("hide", true);

      this.positionLine = svg.append("rect").attr("class", "hover-line").attr("x", 0 - (this.seekLineWidth / 2)).attr("width", this.seekLineWidth).attr("y", 0).attr("height", h); // top to bottom
    }
  };

  Waveform.prototype.update = function (start, end) {
    var data = this.channelData.slice(start, end);
    if (data && data.length) {
      this.buffered.attr("d", this.area(data));
    }
  };
  return Waveform;
})();

module.exports = Waveform;