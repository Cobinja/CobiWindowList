/*
 * applet.js
 * Copyright (C) 2013 Lars Mueller <cobinja@yahoo.de>
 * 
 * CobiWindowList is free software: you can redistribute it and/or modify it
 * under the terms of the GNU General Public License as published by the
 * Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * 
 * CobiWindowList is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 * 
 * You should have received a copy of the GNU General Public License along
 * with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

const Applet = imports.ui.applet;
const St = imports.gi.St;
const Cinnamon = imports.gi.Cinnamon;
const Lang = imports.lang;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Tweener = imports.ui.tweener;
const Signals = imports.signals;
const Meta = imports.gi.Meta;
const Main = imports.ui.main;
const Tooltips = imports.ui.tooltips;
const PopupMenu = imports.ui.popupMenu;
const BoxPointer = imports.ui.boxpointer;
const Clutter = imports.gi.Clutter;
const Mainloop = imports.mainloop;
const Util = imports.misc.util;

const UUID = "windowlist@cobinja.de";

const APPLET_DIR = imports.ui.appletManager.appletMeta[UUID].path;

const ANIMATION_TIME = 0.5;
const DEFAULT_ICON_SIZE = 22;
const MINIMUM_ICON_SIZE = 16;
const ICON_HEIGHT_FACTOR = .8;

const CobiCaptionType = {
  Name: 0,
  Title: 1
}

const CobiDisplayCaption = {
  No: 0,
  All: 1,
  Running: 2,
  Focused: 3
}

const CobiDisplayNumber = {
  No: 0,
  All: 1,
  Smart: 2
}

const CobiGroupWindows = {
  No: 0,
  Always: 1,
  Smart: 2
}

function _(text) {
  return window._(text);
}

function _hasFocus(metaWindow) {
  if (metaWindow.appears_focused) {
    return true;
  }
  let transientHasFocus = false;
  metaWindow.foreach_transient(function(transient) {
    if (transient.appears_focused) {
      transientHasFocus = true;
      return false;
    }
    return true;
  }); 
  return transientHasFocus;
}

function compareArray(x, y) {
  // mimic non-extisting logical xor
  // to determine if one of the
  // parameters is undefined and the other on is not
  if (!(x == undefined) != !(y == undefined)) {
    return false;
  }
  if (x === y) {
    return true;
  }
  if (x.length != y.length) {
    return false;
  }
  for (key in x) {
    // recursive call in case of a nested array
    if (!compareArray(x[key], y[key])) {
      return false;
    }
  }
  return true;
}

function showActor(actor, animate, time) {
  if (!actor.visible) {
    let width = actor.get_width();
    if (!animate) {
      actor.show();
    }
    else {
      actor.set_width(0);
      actor.show();
      Tweener.addTween(actor, {
        width: width,
        time: time,
        transition: "easeInOutQuad",
        onComplete: Lang.bind(this, function() {
          actor.set_width(-1);
        })
      });
    }
  }
}

function hideActor(actor, animate, time) {
  if (actor.visible) {
    let width = actor.get_width();
    if (animate) {
      Tweener.addTween(actor, {
        width: 0,
        time: time,
        transition: "easeInOutQuad",
        onCompleteScope: this,
        onComplete: Lang.bind(this, function () {
          actor.hide();
          actor.set_width(-1);
        })
      });
    }
    else {
      actor.hide();
    }
  }
}

function duplicate(ar) {
}

function createWindowClone(metaWindow, size, withTransients, withPositions) {
  let clones = [];
  let textures = [];
  
  if (!metaWindow) {
    return clones;
  }
  
  let metaWindowActor = metaWindow.get_compositor_private();
  if (!metaWindowActor) {
    return clones;
  }
  let texture = metaWindowActor.get_texture();
  let [width, height] = metaWindowActor.get_size();
  let [maxWidth, maxHeight] = [width, height];
  let [x, y] = metaWindowActor.get_position();
  let [minX, minY] = [x, y];
  let [maxX, maxY] = [minX + width, minY + height];
  textures.push({t: texture, x: x, y: y, w: width, h: height});
  if (withTransients) {
    metaWindow.foreach_transient(function(win) {
      let metaWindowActor = win.get_compositor_private();
      texture = metaWindowActor.get_texture();
      [width, height] = metaWindowActor.get_size();
      [x, y] = metaWindowActor.get_position();
      maxWidth = Math.max(maxWidth, width);
      maxHeight = Math.max(maxHeight, height);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x + width);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y + height);
      textures.push({t: texture, x: x, y: y, w: width, h: height});
    });
  }
  let scale = 1;
  if (size) {
    if (withPositions) {
      scale = Math.min(size/Math.max(maxX - minX, maxY - minY), 1);
    }
    else {
      scale = Math.min(size/Math.max(maxWidth, maxHeight), 1);
    }
  }
  for (i in textures) {
    let data = textures[i];
    let [texture, width, height, x, y] = [data.t, data.w, data.h, data.x, data.y];
    if (withPositions) {
      x -= minX;
      y -= minY;
    }
    let params = {};
    params.source = texture;
    if (scale != 1) {
      params.width = Math.round(width * scale);
      params.height = Math.round(height * scale);
      x = Math.round(x * scale);
      y = Math.round(y * scale);
    }
    let clone = {actor: new Clutter.Clone(params), x: x, y: y};
    clones.push(clone);
  }
  return clones;
}

function CobiSignalTracker() {
  this._init();
}

CobiSignalTracker.prototype = {
  _init: function() {
      this._data = [];
  },

  // params = {
  //   signalName: Signal Name
  //   callback: Callback Function
  //   bind: Context to bind to
  //   target: target to connect to
  //}
  connect: function (params) {
    let signalName = params["signalName"];
    let callback = params["callback"];
    let bind = params["bind"];
    let target = params["target"];
    let signalId = null;

    signalId = target.connect(signalName, Lang.bind(bind, callback));
    this._data.push({
      signalName: signalName,
      callback: callback,
      target: target,
      signalId: signalId,
      bind: bind
    });
  },

  disconnect: function (params) {
    for (let i = 0; i < this._data.length; i++) {
      let data = this._data[i];
      if (params["signalName"] == data["signalName"] &&
          params["target"] == data["target"] &&
          params["callback"] == data["callback"] &&
          params["bind"] == data["bind"]) {
        data["target"].disconnect(data["signalId"]);
        data = null;
        this._data.splice(i, 1);
        break;
      }
    }
  },

  disconnectAll: function () {
    for (let i = 0; i < this._data.length; i++) {
      let data = this._data[i];
      data["target"].disconnect(data["signalId"]);
      data[i] = null;
    }
    this._data = [];
  },
  
  destroy: function() {
    this.disconnectAll();
    this._data = null;
  }
};

function CobiSettings() {
  let __instance;
  CobiSettings = function CobiSettings() {
    if (!__instance) {
      this._init();
    }
    return __instance;
  }
  CobiSettings.prototype = this;
  __instance = new CobiSettings();
  __instance.constructor = CobiSettings;
  return __instance;
}

CobiSettings.prototype = {
  _init: function() {
    this._signalTracker = new CobiSignalTracker();
    this.values = {};
    
    let settingsDirName = GLib.get_user_config_dir();
    if (!settingsDirName) {
      settingsDirName = GLib.get_home_dir() + "/.config";
    }
    settingsDirName += "/cobinja/" + UUID;
    this._settingsDir = Gio.file_new_for_path(settingsDirName);
    if (!this._settingsDir.query_exists(null)) {
      this._settingsDir.make_directory_with_parents(null);
    }
    
    this._settingsFile = this._settingsDir.get_child("settings.json");
    if (!this._settingsFile.query_exists(null)) {
      this._getDefaultSettingsFile().copy(this._settingsFile, 0, null, null);
    }
    
    this._onSettingsChanged();
    
    this._monitor = this._settingsFile.monitor(Gio.FileMonitorFlags.NONE, null);
    this._signalTracker.connect({signalName: "changed", callback: Lang.bind(this, this._onSettingsChanged), bind: this, target: this._monitor});
  },
  
  _getDefaultSettingsFile: function() {
    return Gio.file_new_for_path(APPLET_DIR + "/default_settings.json");
  },
  
  _onSettingsChanged: function() {
    let settings;
    try {
      settings = JSON.parse(Cinnamon.get_file_contents_utf8_sync(this._settingsFile.get_path()));
    }
    catch (e) {
      global.logError("Could not parse CobiWindowList's settings.json")
      global.logError(e);
      return true;
    }
    
    for (key in settings) {
      if (settings.hasOwnProperty(key)) {
        let comparison;
        if (settings[key] instanceof Array) {
          comparison = !compareArray(this.values[key], settings[key]);
        }
        else {
          comparison = this.values[key] !== settings[key];
        }
        if (comparison) {
          this.values[key] = settings[key];
          this.emit(key + "-changed", this.values[key]);
        }
      }
    }
    return true;
  },
    
  setValue: function(key, value) {
    if (!compareArray(value, this.values[key])) {
      this.values[key] = value;
      this.emit(key + "-changed", this.values[key]);
      this._writeSettings();
    }
  },
  
  _writeSettings: function() {
    let filedata = JSON.stringify(this.values, null, "  ");
    GLib.file_set_contents(this._settingsFile.get_path(), filedata, filedata.length);
  },
  
  destroy: function() {
    this._signalTracker.disconnectAll();
    this._signalTracker.destroy();
    this._monitor.cancel();
    this.values = null;
  }
}

Signals.addSignalMethods(CobiSettings.prototype);

function CobiPopupMenuItem(appButton, metaWindow) {
  this._init(appButton, metaWindow);
}

CobiPopupMenuItem.prototype = {
  __proto__: PopupMenu.PopupMenuBase,
  
  _init: function(appButton, metaWindow) {
    PopupBaseMenuItem.prototype._init.call(this);
    this._appButton = appButton;
    this._metaWindow = window;
    
    this._box = Cinnamon.GenericContainer();
    this.addActor(this._box);
    
    this._cloneBox = new St.Group();
    let clones = createWindowClone(this._metawindow, 140, true, true);
    for (let i = 0; i < clones.length; i++) {
      let clone = clones[i];
      this._cloneBox.add_actor(clone.actor);
      clone.actor.set_position(clone.x, clone.y);
    }
    menuItem.connect("activate", function() {
      Main.activateWindow(window);
    });
    
    this._closeButton = new St.Bin({
      style_class: 'window-close',
      reactive: true
    });
    this._closeButton.hide();
    
    this._label = new St.Label();
    this._box.add_actor(this._label);
    let text = this._metaWindow.get_title();
    if (!text) {
      text = this._appButton._app.get_name();
    }
    if (!text) {
      text = "?";
    }
    this._label.set_text(text);
  },
  
  _getPreferredWidth: function(forHeight) {
    return 150;
  },
  
  _getPreferredHeight: function(forWidth) {
    return 170;
  },
  
  _allocateBox: function(actor, box, flags) {
    
  }
}

function CobiPopupMenu(appButton) {
  this._init(appButton);
}

CobiPopupMenu.prototype = {
  __proto__: PopupMenu.PopupMenu.prototype,
  
  _init: function(appButton) {
    PopupMenu.PopupMenu.prototype._init.call(this, appButton.actor, 0.5, appButton._applet.orientation, 0);
    this._appButton = appButton;
    this._settings = new CobiSettings();
    this._signalTracker = new CobiSignalTracker();
    
    global.focus_manager.add_group(this.actor);
    this.actor.reactive = true;
    //Main.uiGroup.add_actor(this.actor);
    Main.layoutManager.addChrome(this.actor);
    this.actor.hide();
    
    if (!Main.software_rendering) {
      this.box.set_vertical(false);
    }
    
    this._signalTracker.connect({signalName: "enter-event", target: this.actor, bind: this, callback: Lang.bind(this, this._onEnterEvent)});
    this._signalTracker.connect({signalName: "leave-event", target: this.actor, bind: this, callback: Lang.bind(this, this._onLeaveEvent)});
  },
  
  setMaxHeight: function() {
    let monitor = Main.layoutManager.primaryMonitor;
    this.actor.style = ("max-height: " +
                        Math.round(monitor.height - (this._appButton._applet._panelHeight)) +
                        "px;");
  },
  
  deleteDelay: function() {
    if (this._delayId) {
      Mainloop.source_remove(this._delayId);
    }
  },
  
  openDelay: function() {
    this.deleteDelay();
    this._delayId = Mainloop.timeout_add(this._settings.values["preview-timeout-show"], Lang.bind(this, this.open));
  },
  
  closeDelay: function() {
    this.deleteDelay();
    this._delayId = Mainloop.timeout_add(this._settings.values["preview-timeout-hide"], Lang.bind(this, this.close));
  },
  
  _onEnterEvent: function() {
    this.deleteDelay();
  },
  
  _onLeaveEvent: function() {
    this.closeDelay();
  },
  
  open: function(animate) {
    if (!this._appButton.hasWindowsOnWorkspace() || this._appButton._windows.length < 2 || this.isOpen) {
      return;
    }
    this.deleteDelay();
    this.removeAll();
    
    let screen = global.screen;
    let workspace = screen.get_active_workspace();
    for (let i = 0; i < this._appButton._windows.length; i++) {
      let window = this._appButton._windows[i];
      if ((window.get_workspace() == workspace) || (window.is_on_all_workspaces() && window.get_screen() == screen)) {
        let label = new St.Label({text: window.get_title(), width: 150});
        let menuItem = new PopupMenu.PopupBaseMenuItem();
        let cloneBox = new St.Group();
        menuItem.addActor(cloneBox);
        cloneBox.add_actor(label);
        let clones = createWindowClone(window, 150, true, true);
        for (let i = 0; i < clones.length; i++) {
          let clone = clones[i];
          cloneBox.add_actor(clone.actor);
          clone.actor.set_position(clone.x, clone.y + 20);
        }
        menuItem.connect("activate", function() {
          Main.activateWindow(window);
        });
        this.addMenuItem(menuItem);
      }
    }
    
    PopupMenu.PopupMenu.prototype.open.call(this, animate);
  },
  
  close: function(animate) {
    if (!this.isOpen) {
      return;
    }
    this.deleteDelay();
    
    global.menuStackLength -= 1;

    Main.panel._hidePanel();
    if (Main.panel2 != null) {
      Main.panel2._hidePanel();
    }

    if (this._activeMenuItem) {
      this._activeMenuItem.setActive(false);
    }

    this._boxPointer.hide(true, Lang.bind(this, this.removeAll));

    this.isOpen = false;
    this.emit('open-state-changed', false);
  }
}

function CobiAppButton(applet, app, orientation) {
  this._init(applet, app, orientation);
}

CobiAppButton.prototype = {
  _init: function(applet, app, orientation) {
    this._applet = applet;
    this._app = app;
    this.orientation = orientation;
    this._settings = new CobiSettings();
    this._signalTracker = new CobiSignalTracker();
    
    this.actor = new Cinnamon.GenericContainer({style_class: "window-list-item-box",
                                         track_hover: true,
                                         can_focus: true,
                                         reactive: true
    });
    this._buttonContainer = new St.BoxLayout();
    this.actor.add_actor(this._buttonContainer);
    
    this._labelNumber = new St.Label();
    this.actor.add_actor(this._labelNumber);
    
    this._label = new St.Label({style_class: "window-list-item-label"});
    this._labelBox = new St.Bin({visible: false});
    this._labelBox.add_actor(this._label);
    
    this._icon = null;
    this._iconBox = new St.Bin({name: "appMenuIcon"});
    
    this._tooltip = new Tooltips.PanelItemTooltip(this, this._app.get_name(), this.orientation);
    
    this.actor._delegate = this;
    let direction = this.actor.get_text_direction();
    if (direction == Clutter.TextDirection.LTR) {
      this._buttonContainer.add_actor(this._iconBox);
      this._buttonContainer.add_actor(this._labelBox);
    }
    else {
      this._buttonContainer.add_actor(this._labelBox);
      this._buttonContainer.add_actor(this._iconBox);
    }
    
    this._windows = [];
    this._currentWindow = null;
    
    this.actor.add_style_pseudo_class("neutral");
    
    this._menuManager = new PopupMenu.PopupMenuManager(this);
    this._contextMenuManager = new PopupMenu.PopupMenuManager(this);
    this.menu = new CobiPopupMenu(this);
    this._contextMenu = new Applet.AppletContextMenu(this, this._applet.orientation);
    this._menuManager.addMenu(this._contextMenu);
    
    this._signalTracker.connect({signalName: "button-release-event", target: this.actor, bind: this, callback: Lang.bind(this, this._onButtonRelease)});
    this._signalTracker.connect({signalName: "caption-type-changed", target: this._settings, bind: this, callback: Lang.bind(this, this._updateLabel)});
    this._signalTracker.connect({signalName: "display-caption-for-changed", target: this._settings, bind: this, callback: Lang.bind(this, this._updateLabelVisibility)});
    this._signalTracker.connect({signalName: "display-number-changed", target: this._settings, bind: this, callback: Lang.bind(this, this._updateNumber)});
    this._signalTracker.connect({signalName: "enter-event", target: this.actor, bind: this, callback: Lang.bind(this, this._onEnterEvent)});
    this._signalTracker.connect({signalName: "leave-event", target: this.actor, bind: this, callback: Lang.bind(this, this._onLeaveEvent)});
    
    this._signalTracker.connect({signalName: "get-preferred-width", target: this.actor, bind: this, callback: Lang.bind(this, this._getContentPreferredWidth)});
    this._signalTracker.connect({signalName: "get-preferred-height", target: this.actor, bind: this, callback: Lang.bind(this, this._getContentPreferredHeight)});
    this._signalTracker.connect({signalName: "allocate", target: this.actor, bind: this, callback: Lang.bind(this, this._allocateContent)});
  },
  
  getPinnedIndex: function() {
    return this._settings.values["pinned-apps"].indexOf(this._app.get_id());
  },
  
  addWindow: function(metaWindow) {
    let currentWorkspace = global.screen.get_active_workspace();
    this._windows.push(metaWindow);
    this._updateCurrentWindow();
    this._updateNumber();
    this._updateLabel();
    this._signalTracker.connect({signalName: "notify::title", target: metaWindow, bind: this, callback: Lang.bind(this, this._updateLabel)});
    this._signalTracker.connect({signalName: "notify::minimized", target: metaWindow, bind: this, callback: Lang.bind(this, this._onMinimized)});
    this.actor.remove_style_pseudo_class("neutral");
    this._updateTooltip();
    let wsWindows = this.getWindowsOnCurrentWorkspace();
    if (wsWindows.length == 2) {
      this._applet.menuManager.addMenu(this.menu);
    }
  },
  
  removeWindow: function(metaWindow) {
    this._signalTracker.disconnect({signalName: "notify::title", target: metaWindow, bind: this, callback: Lang.bind(this, this._updateLabel)});
    this._signalTracker.disconnect({signalName: "notify::minimized", target: metaWindow, bind: this, callback: Lang.bind(this, this._onMinimized)});
    let arIndex = this._windows.indexOf(metaWindow);
    if (arIndex >= 0) {
      this._windows.splice(arIndex, 1);
      this._updateCurrentWindow();
    }
    if (this.getPinnedIndex() >= 0) {
      if (!this._currentWindow) {
        this.actor.remove_style_pseudo_class("focus");
        this.actor.remove_style_pseudo_class("active");
        this.actor.add_style_pseudo_class("neutral");
        this._applet.menuManager.removeMenu(this.menu);
      }
    }
    this._updateTooltip();
    this._updateNumber();
    this._updateVisibility();
  },
  
  getWindowsOnCurrentWorkspace: function() {
    let workspaceIndex = global.screen.get_active_workspace_index();
    return this.getWindowsOnWorkspace(workspaceIndex);
  },
  
  getWindowsOnWorkspace: function(workspaceIndex) {
    let wsWindows = this._windows.filter(function(win) {
      return win.is_on_all_workspaces() || (workspaceIndex == win.get_workspace().index());
    });
    return wsWindows;
  },
  
  _updateCurrentWindow: function() {
    let wsWindows = this.getWindowsOnCurrentWorkspace();
    if (wsWindows.length > 1) {
      wsWindows = wsWindows.sort(function(a, b) {
        return b.user_time - a.user_time;
      });
    }
    this._currentWindow = wsWindows.length > 0 ? wsWindows[0] : null;
    if (this._currentWindow) {
      this._updateLabel();
    }
  },
  
  _updateTooltip: function() {
    if (this.getWindowsOnCurrentWorkspace().length < 2) {
      if (!this._tooltip) {
        this._tooltip = new Tooltips.PanelItemTooltip(this, this._app.get_name(), this.orientation);
      }
    }
    else {
      if (this._tooltip) {
        this._tooltip.hide();
        this._tooltip.destroy();
        this._tooltip = null;
      }
    }
  },
  
  updateIcon: function() {
    let panelHeight = this._applet._panelHeight;
    if (global.settings.get_boolean("panel-scale-text-icons") && global.settings.get_boolean("panel-resizable")) {
      this.iconSize = Math.round(panelHeight * ICON_HEIGHT_FACTOR);
    }
    else {
      this.iconSize = ((panelHeight - 4) > DEFAULT_ICON_SIZE) ? DEFAULT_ICON_SIZE : MINIMUM_ICON_SIZE;
    }
    this._icon = this._app ?
                          this._app.create_icon_texture(this.iconSize) :
                          new St.Icon({ icon_name: "application-default-icon",
                                        icon_type: St.IconType.FULLCOLOR,
                                        icon_size: this.iconSize });
    this._iconBox.set_child(this._icon);
    // let the difference between icon size and iconbox width be even
    // so that the icon can be exactly vertically centered inside the box
    let allocBox = this._iconBox.get_allocation_box();
    let allocHeight = allocBox.y2 - allocBox.y1;
    if ((allocHeight - this.iconSize) & 1) {
      allocHeight++;
    }
    this._iconBox.set_width(allocHeight);
  },
  
  updateCaption: function() {
    this._updateLabel();
    this._updateLabelVisibility();
  },
  
  _updateNumber: function() {
    let setting = this._settings.values["display-number"];
    let text = "";
    let number = this.getWindowsOnCurrentWorkspace().length;
    if ((setting == CobiDisplayNumber.All && number >= 1) || (setting == CobiDisplayNumber.Smart && number >= 2)) {
      text = "" + number;
    }
    this._labelNumber.set_text(text);
  },
  
  _updateLabel: function() {
    let captionType = this._settings.values["caption-type"];
    let text;
    if (captionType == CobiCaptionType.Title && this._currentWindow) {
      text = this._currentWindow.get_title();
    }
    if (!text) {
      text = this._app.get_name();
    }
    if (!text) {
      text = "?";
    }
    if (this._currentWindow && this._currentWindow.minimized) {
      text = "[" + text + "]";
    }
    this._label.set_text(text);
  },
  
  _updateLabelVisibility: function() {
    let value = this._settings.values["display-caption-for"];
    switch (value) {
      case CobiDisplayCaption.No:
        hideActor(this._labelBox, true, ANIMATION_TIME);
        break;
      case CobiDisplayCaption.All:
        showActor(this._labelBox, true, ANIMATION_TIME);
        break;
      case CobiDisplayCaption.Running:
        if (this._currentWindow) {
          showActor(this._labelBox, true, ANIMATION_TIME);
        }
        else {
          hideActor(this._labelBox, true, ANIMATION_TIME);
        }
        break;
      case CobiDisplayCaption.Focused:
        if (this._hasFocus()) {
          showActor(this._labelBox, true, ANIMATION_TIME);
        }
        else {
          hideActor(this._labelBox, true, ANIMATION_TIME);
        }
        break;
      default:
        break;
    }
  },
  
  _updateState: function() {
    if (this._currentWindow) {
      if (this.actor.has_style_pseudo_class("neutral")) {
        this.actor.remove_style_pseudo_class("neutral");
      }
    }
    else {
      if (this.actor.has_style_pseudo_class("focus")) {
        this.actor.remove_style_pseudo_class("focus");
      }
      if (!this.actor.has_style_pseudo_class("neutral")) {
        this.actor.add_style_pseudo_class("neutral");
      }
    }
  },
  
  hasWindowsOnWorkspace: function() {
    let index = global.screen.get_active_workspace_index();
    return this._windows.some(function(win) {
      return win.is_on_all_workspaces() || win.get_workspace().index() == index;
    });
  },
  
  _updateFocus: function() {
    let wsWindows = this.getWindowsOnCurrentWorkspace();
    for (let i = 0; i < wsWindows.length; i++) {
      let metaWindow = wsWindows[i];
      if (_hasFocus(metaWindow) && !metaWindow.minimized) {
        this.actor.add_style_pseudo_class("focus");
        if (!this.actor.get_track_hover()) {
          this.actor.set_track_hover(true);
        }
        this.actor.remove_style_class_name("window-list-item-demands-attention");    	
        this.actor.remove_style_class_name("window-list-item-demands-attention-top");
        this._currentWindow = metaWindow;
        this._updateLabel();
        break;
      }
      else {
        this.actor.remove_style_pseudo_class("focus");
      }
    }
    this.updateCaption();
  },
  
  _updateVisibility: function() {
    if (this.hasWindowsOnWorkspace()) {
      showActor(this.actor, false);
    }
    else if (this.getPinnedIndex() >= 0) {
      showActor(this.actor, false);
    }
    else {
      hideActor(this.actor, false);
    }
  },
  
  updateView: function() {
    this._updateCurrentWindow();
    this._updateState();
    this._updateNumber();
    this._updateFocus();
    this._updateVisibility();
    this._updateTooltip();
  },
  
  demandAttention: function(metaWindow) {
    if (this.actor.has_style_pseudo_class("hover")) {
      this.actor.remove_style_pseudo_class("hover");
    }
    this.actor.set_track_hover(false);
    this.actor.add_style_class_name("window-list-item-demands-attention");
  },
  
  destroy: function() {
    this._signalTracker.disconnectAll();
    this._signalTracker = null;
    this._labelNumber.destroy();
    this._labelNumber = null;
    this._labelBox.destroy();
    this._labelBox = null;
    this._label.destroy();
    this._label = null;
    this._icon.destroy();
    this._icon = null;
    this._iconBox.destroy();
    this._iconBox = null;
    this._buttonContainer.destroy();
    this._buttonContainer = null;
    this.actor.destroy();
    this.actor = null;
    if (this._tooltip) {
      this._tooltip.hide();
      this._tooltip.destroy();
      this._tooltip = null;
    }
    this._app = null;
    this._applet.menuManager.removeMenu(this.menu);
    this.menu = null;
    this._menuManager.removeMenu(this._contextMenu);
    this._contextMenu = null;
    this._applet = null;
    this._settings = null;
  },
  
  _onButtonRelease: function(actor, event) {
    this.menu.deleteDelay();
    if (this._contextMenu.isOpen) {
      this._contextMenu.close();
      return;
    }
    if (this.menu.isOpen) {
      this.menu.close();
      return;
    }
    // left mouse button
    if (event.get_state() & Clutter.ModifierType.BUTTON1_MASK) {
      if (this._currentWindow) {
        if (this.hasWindowsOnWorkspace()) {
          let wsWindows = this.getWindowsOnCurrentWorkspace();
          if (wsWindows.length == 1) {
            if (_hasFocus(this._currentWindow)) {
              this._currentWindow.minimize();
            }
            else {
              Main.activateWindow(this._currentWindow);
            }
          }
          else {
            this.menu.open();
            //Main.activateWindow(this._currentWindow);
          }
        }
        else {
          this._startApp();
        }
      }
      else {
        this._startApp();
      }
    }
    // middle mouse button
    else if (event.get_state() & Clutter.ModifierType.BUTTON2_MASK) {
      this._startApp();
    }
    // right mouse button
    else if (event.get_state() & Clutter.ModifierType.BUTTON3_MASK) {
      // context menu
      this._populateContextMenu();
      this._contextMenu.open();
    }
  },
  
  _animateIcon: function(animationTime) {
    Tweener.addTween(this._icon, {
      opacity: 70,
      transition: "easeOutExpo",
      time: animationTime * 0.2,
      onCompleteScope: this,
      onComplete: Lang.bind(this, function() {
        Tweener.addTween(this._icon, {
          opacity: 255,
          transition: "easeOutBounce",
          time: animationTime * 0.8
        })
      })
    });
  },
  
  _startApp: function() {
    this._app.open_new_window(-1);
    let animationTime = this._settings.values["animation-time"] / 1000;
    this._animateIcon(animationTime);
  },
  
  _onEnterEvent: function() {
    if (this.getWindowsOnCurrentWorkspace().length > 1) {
      this.menu.openDelay();
    }
  },
  
  _onLeaveEvent: function() {
    if (this.getWindowsOnCurrentWorkspace().length > 1) {
      this.menu.closeDelay();
    }
  },
  
  _onMinimized: function(metaWindow) {
    if (this._currentWindow == metaWindow) {
      this._updateFocus();
    }
  },
  
  _hasFocus: function() {
    let windows = this.getWindowsOnCurrentWorkspace();
    for (let i = 0; i < windows.length; i++) {
      let window = windows[i];
      if (_hasFocus(window)) {
        return true;
      }
    }
    return false;
  },
  
  _populateContextMenu: function() {
    this._contextMenu.removeAll();
    
    // applet-wide
    this._contextMenu.addAction(_("Settings"), Lang.bind(this, function() {Util.spawnCommandLine(APPLET_DIR + "/settings.py");}));
    
    // app-wide
    this._contextMenu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    this._contextMenu.addAction(_("New Window"), Lang.bind(this, this._startApp));
    
    if (this._settings.values["display-pinned"]) {
      if (this.getPinnedIndex() >= 0) {
        this._contextMenu.addAction(_("Unpin Favorite"), Lang.bind(this, function() {
          this._applet.unpinApp(this);
        }));
      }
      else {
        this._contextMenu.addAction(_("Pin as Favorite"), Lang.bind(this, function() {
          this._applet.pinApp(this);
        }));
      }
    }
    
    if (this._currentWindow) {
      this._contextMenu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
      // window ops for workspaces
      if (this._currentWindow.is_on_all_workspaces()) {
        this._contextMenu.addAction(_("Only on this workspace"), Lang.bind(this, function() {this._currentWindow.unstick()}));
      }
      else {
        this._contextMenu.addAction(_("Visible on all workspaces"), Lang.bind(this, function() {this._currentWindow.stick()}));
        let workspace = this._currentWindow.get_workspace();
        
        let workspaceLeft = workspace.get_neighbor(Meta.MotionDirection.LEFT);
        if (workspaceLeft != workspace) {
          this._contextMenu.addAction(_("Move to left workspace"), Lang.bind(this, function() {
            this._currentWindow.change_workspace(workspaceLeft);
          }));
        }
        let workspaceRight = workspace.get_neighbor(Meta.MotionDirection.RIGHT);
        if (workspaceRight != workspace) {
          this._contextMenu.addAction(_("Move to right workspace"), Lang.bind(this, function() {
            this._currentWindow.change_workspace(workspaceRight);
          }));
        }
      }
      
      this._contextMenu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
      // window specific
      if (this._currentWindow.minimized) {
        this._contextMenu.addAction(_("Restore"), Lang.bind(this, function() { this._currentWindow.unminimize()}));
      }
      else {
        this._contextMenu.addAction(_("Minimize"), Lang.bind(this, function() { this._currentWindow.minimize()}));
      }
      
      if (this._currentWindow.get_maximized()) {
        this._contextMenu.addAction(_("Unmaximize"), Lang.bind(this, function() { this._currentWindow.unmaximize(Meta.MaximizeFlags.VERTICAL | Meta.MaximizeFlags.HORIZONTAL)}));
      }
      
      this._contextMenu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
      let wsWindows = this.getWindowsOnCurrentWorkspace();
      if (wsWindows.length > 1) {
        this._contextMenu.addAction(_("Close others"), function() {
          for (let i = wsWindows.length - 1; i > 0; i--) {
            wsWindows[i].delete(global.get_current_time());
          }
        });
      }
      
      if (wsWindows.length > 1) {
        this._contextMenu.addAction(_("Close all"), function() {
          for (let i = wsWindows.length - 1; i >= 0; i--) {
            wsWindows[i].delete(global.get_current_time());
          }
        });
      }
      
      this._contextMenu.addAction(_("Close"), Lang.bind(this, function() {this._currentWindow.delete(global.get_current_time())}));
    }
  },
  
  _getContentPreferredWidth: function(actor, forHeight, alloc) {
    [alloc.min_size, alloc.natural_size] = this._buttonContainer.get_preferred_width(forHeight);
  },

  _getContentPreferredHeight: function(actor, forWidth, alloc) {
    [alloc.min_size, alloc.natural_size] = this._buttonContainer.get_preferred_height(forWidth);
  },
  
  _allocateContent: function(actor, box, flags) {
    this._buttonContainer.allocate(box, flags);
    
    let [minWidth, naturalWidth, minHeight, naturalHeight] = this._labelNumber.get_preferred_size();
    let childBox = new Clutter.ActorBox();
    childBox.y1 = 1;
    childBox.y2 = Math.min(box.y2 - 1, childBox.y1 + naturalHeight);
    let direction = this.actor.get_text_direction();
    if (direction == Clutter.TextDirection.LTR) {
      childBox.x1 = 1;
      childBox.x2 = Math.min(box.x2 - 1, childBox.x1 + naturalWidth);
    }
    else {
      childBox.x2 = box.x2 - 1;
      childBox.x1 = Math.max(1, childBox.x1 - naturalWidth);
    }
    this._labelNumber.allocate(childBox, flags);
  }
  
}

function CobiWindowList(orientation, panelHeight) {
  this._init(orientation, panelHeight);
}

CobiWindowList.prototype = {
  __proto__: Applet.Applet.prototype,
  
  _init: function(orientation, panelHeight) {
    Applet.Applet.prototype._init.call(this, orientation, panelHeight);
    this.actor.set_track_hover(false);
    this.actor.add_style_class_name("window-list-box");
    this.orientation = orientation;
    
    this.dragInProgress = false;
    
    this._windowTracker = Cinnamon.WindowTracker.get_default();
    this._appSys = Cinnamon.AppSystem.get_default();
    
    this.menuManager = new PopupMenu.PopupMenuManager(this);
    this.menuManager._onEventCapture = function (actor, event) {
        return false;
    };
    
    this._appButtons = [];
    this._settings = new CobiSettings();
    this._signalTracker = new CobiSignalTracker();
    
    //this.actor.reactive = global.settings.get_boolean("panel-edit-mode");
    this.on_orientation_changed(orientation);
    
    this._workspaces = [];
  },
  
  on_applet_added_to_panel: function() {
    if (this._settings.values["display-pinned"]) {
      this._updatePinnedApps();
    }
    this._onWorkspacesChanged();
    this.emit("connect-signals");
    this._signalTracker.connect({signalName: "switch-workspace", target: global.window_manager, bind: this, callback: Lang.bind(this, this._updateAppButtonVisibility)});
    this._signalTracker.connect({signalName: "changed::panel-edit-mode", target: global.settings, bind: this, callback: Lang.bind(this, this._on_panel_edit_mode_changed)});
    this._signalTracker.connect({signalName: "window-demands-attention", target: global.display, bind: this, callback: Lang.bind(this, this._onWindowDemandsAttention)});
    this._signalTracker.connect({signalName: "window-marked-urgent", target: global.display, bind: this, callback: Lang.bind(this, this._onWindowDemandsAttention)});
    this._signalTracker.connect({signalName: "notify::n-workspaces", target: global.screen, bind: this, callback: Lang.bind(this, this._onWorkspacesChanged)});
    this._signalTracker.connect({signalName: "notify::focus-app", target: this._windowTracker, bind: this, callback: Lang.bind(this, this._updateFocus)});
    this._signalTracker.connect({signalName: "pinned-apps-changed", target: this._settings, bind: this, callback: Lang.bind(this, this._updatePinnedApps)});
    this._signalTracker.connect({signalName: "display-pinned-changed", target: this._settings, bind: this, callback: Lang.bind(this, this._onDisplayPinnedChanged)});
  },
  
  on_applet_removed_from_panel: function() {
    this._signalTracker.disconnectAll();
    this.emit("disconnect-signals");
  },
  
  _on_panel_edit_mode_changed: function () {
    let panelEditMode = global.settings.get_boolean("panel-edit-mode");
    if (panelEditMode) {
      this.actor.set_track_hover(true);
    }
    else {
      this.actor.remove_style_pseudo_class("hover");
      this.actor.set_track_hover(false);
    }
    //this.actor.reactive = panelEditMode;
  },
  
  on_panel_height_changed: function() {
    for (i in this._appButtons) {
      this._appButtons[i].updateIcon();
    }
  },
  
  on_orientation_changed: function(orientation) {
    this.orientation = orientation;
    if (orientation == St.Side.TOP) {
      this.actor.remove_style_class_name("window-list-box-bottom");
      this.actor.add_style_class_name("window-list-box-top");
    }
    else {
      this.actor.remove_style_class_name("window-list-box-top");
      this.actor.add_style_class_name("window-list-box-bottom");
    }
  },
  
  _addAppButton: function(app) {
    if (app) {
      let appId = app.get_id();
      if (!this._appButtons.some(function(appButton) {
          return appButton._app.get_id() == appId;
        })) {
        let appButton = new CobiAppButton(this, app, this.orientation);
        this._appButtons.push(appButton);
        this.actor.add_actor(appButton.actor);
        appButton.updateIcon();
        showActor(appButton.actor, false);
        appButton.updateCaption();
        return appButton;
      }
    }
    return undefined;
  },
  
  _removeAppButton: function(appButton) {
    let index = this._appButtons.indexOf(appButton);
    if (index >= 0) {
      this._appButtons.splice(index, 1);
    }
    this.actor.remove_actor(appButton.actor);
    appButton.destroy();
  },
  
  _lookupAppButtonForWindow: function(metaWindow) {
    let appButtons = this._appButtons.filter(function(appButton) {
      return appButton._windows.indexOf(metaWindow) >= 0;
    });
    return appButtons.length > 0 ? appButtons[0] : undefined;
  },
  
  _lookupAppButtonForApp: function(app) {
    let appButtons = this._appButtons.filter(function(appButton) {
      return appButton._app == app;
    });
    return appButtons.length > 0 ? appButtons[0] : undefined;
  },
  
  _onWorkspacesChanged: function() {
    for (i in this._workspaces) {
      let ws = this._workspaces[i];
      ws.disconnect(ws._cobiWindowAddedId);
      ws.disconnect(ws._cobiWindowRemovedId);
    }
    
    this._workspaces = [];
    for (let i = 0; i < global.screen.n_workspaces; i++ ) {
      let ws = global.screen.get_workspace_by_index(i);
      this._workspaces[i] = ws;
      let windows = ws.list_windows();
      for (let j = 0; j < windows.length; j++) {
        let metaWindow = windows[j];
        if (!this._lookupAppButtonForWindow(metaWindow)) {
          this._windowAdded(ws, metaWindow);
        }
      }
      ws._cobiWindowAddedId = ws.connect("window-added",
                                     Lang.bind(this, this._windowAdded));
      ws._cobiWindowRemovedId = ws.connect("window-removed",
                                       Lang.bind(this, this._windowRemoved));
    }
  },
  
  _windowAdded: function(metaWorkspace, metaWindow) {
    if (!Main.isInteresting(metaWindow)) {
      return;
    }
    let app = this._windowTracker.get_window_app(metaWindow);
    let appButton = this._lookupAppButtonForWindow(metaWindow);
    if (!appButton) {
      appButton = this._lookupAppButtonForApp(app);
    }
    if (!(this._settings.values["group-windows"] && appButton)) {
      appButton = this._addAppButton(app);
    }
    if (appButton) {
      appButton.addWindow(metaWindow);
    }
    this._updateAppButtonVisibility();
  },
  
  _windowRemoved: function(metaWorkspace, metaWindow) {
    let appButton = this._lookupAppButtonForWindow(metaWindow);
    if (appButton) {
      appButton.removeWindow(metaWindow);
      if (!(this._settings.values["display-pinned"] && appButton.getPinnedIndex() >= 0) && appButton._windows.length == 0) {
        this._removeAppButton(appButton);
      }
    }
  },
  
  _lookupApp: function(appId) {
    let app;
    if (appId) {
      app = this._appSys.lookup_app(appId);
      if (!app) {
        app = this._appSys.lookup_settings_app(appId);
      }
    }
    return app;
  },
  
  _updatePinnedApps: function() {
    if (!this.isPinning) {
      let pinnedApps = this._settings.values["pinned-apps"];
      let pinnedAppsLength = pinnedApps.length;
      let prevPinnedAppButton = null;
      // find new pinned apps
      for (let i = 0; i < pinnedAppsLength; i++) {
        let pinnedAppId = pinnedApps[i];
        let app = this._lookupApp(pinnedAppId);
        let appButton;
        if (app) {
          appButton = this._lookupAppButtonForApp(app);
        }
        if (!appButton) {
          appButton = this._addAppButton(app);
        }
        let actorIndex = -1;
        if (prevPinnedAppButton) {
          let prevActorIndex = this.actor.get_children_list().indexOf(prevPinnedAppButton.actor);
          let appButtonActorIndex = this.actor.get_children_list().indexOf(appButton.actor);
          for (let i = prevActorIndex + 1; i < appButtonActorIndex; i++) {
            let checkAppButtonActor = this.actor.get_child_at_index(i);
            let checkAppButton = checkAppButtonActor._delegate;
            let checkAppButtonPinnedIndex = checkAppButton.getPinnedIndex();
            if (checkAppButtonPinnedIndex >= 0) {
              actorIndex = checkAppButtonPinnedIndex - 1;
            }
          }
        }
        else {
        }
        if (actorIndex >= 0) {
          global.log("pinnedAppId: " + pinnedAppId + ", actorIndex: " + actorIndex);
          this.actor.move_child(appButton.actor, actorIndex);
        }
        
        prevPinnedAppButton = appButton;
      }
    }
    
    for (let i = this._appButtons.length - 1; i >= 0; i--) {
      let appButton = this._appButtons[i];
      if (!(appButton.getPinnedIndex() >= 0) && appButton._windows.length == 0) {
        this._removeAppButton(appButton);
      }
    }
  },
  
  _onDisplayPinnedChanged: function() {
    let setting = this._settings.values["display-pinned"];
    if (setting) {
      this._updatePinnedApps();
    }
    else {
      for (let i = this._appButtons.length - 1; i >= 0; i--) {
        let appButton = this._appButtons[i];
        if (appButton._windows.length == 0) {
          this._removeAppButton(appButton);
        }
      }
    }
  },
  
  pinApp: function(appButton) {
    this.isPinning = true;
    let app = appButton._app;
    let appId = app.get_id();
    let setting = this._settings.values["pinned-apps"].slice();
    if (setting.indexOf(appId) >= 0) {
      this.isPinning = false;
      return;
    }
    let pinIndex = 0;
    let actorList = this.actor.get_children_list();
    let actorIndex = actorList.indexOf(appButton.actor) - 1;
    for (; actorIndex >= 0; actorIndex--) {
      let act = actorList[actorIndex];
      let actPinnedIndex = act._delegate.getPinnedIndex();
      if (actPinnedIndex >= 0) {
        pinIndex = actPinnedIndex + 1;
        break;
      }
    }
    setting.splice(pinIndex, 0, app.get_id());
    this._settings.setValue("pinned-apps", setting);
    this.isPinning = false;
  },
  
  unpinApp: function(appButton) {
    this.isPinning = true;
    let app = appButton._app;
    let appId = app.get_id();
    let setting = this._settings.values["pinned-apps"].slice();
    let settingIndex = setting.indexOf(appId);
    if (settingIndex >= 0) {
      setting.splice(settingIndex, 1);
      this._settings.setValue("pinned-apps", setting);
    }
    this.isPinning = false;
  },
  
  _updateAppButtonVisibility: function() {
    for (let i = 0; i < this._appButtons.length; i++) {
      let appButton = this._appButtons[i];
      appButton.updateView();
    }
    this.actor.queue_relayout();
  },
  
  _onWindowDemandsAttention : function(display, metaWindow) {
    let appButton = this._lookupAppButtonForWindow(metaWindow);
    if (appButton) {
      appButton.demandAttention(metaWindow);
    }
  },
  
  _updateFocus: function() {
    for (let i = 0; i < this._appButtons.length; i++) {
      let appButton = this._appButtons[i];
      appButton._updateFocus();
    }
  }
}

Signals.addSignalMethods(CobiWindowList.prototype);

function main(metadata, orientation, panelHeight) {
  return new CobiWindowList(orientation, panelHeight);
}
