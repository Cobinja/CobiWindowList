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
const AppletManager = imports.ui.appletManager;
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
const Gettext = imports.gettext;
const WindowUtils = imports.misc.windowUtils;
const DND = imports.ui.dnd;
const Settings = imports.ui.settings;
const SignalManager = imports.misc.signalManager;

const UUID = "windowlist@cobinja.de";

const APPLET_DIR = imports.ui.appletManager.appletMeta[UUID].path;

const ANIMATION_TIME = 0.5;
const DEFAULT_ICON_SIZE = 22;
const MINIMUM_ICON_SIZE = 16;
const ICON_HEIGHT_FACTOR = 0.8;

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

Gettext.bindtextdomain(UUID, APPLET_DIR + "/locale");

function _(text) {
  let locText = Gettext.dgettext(UUID, text);
  if (locText == text) {
    locText = window._(text);
  }
  return locText;
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
  // parameters is undefined and the other one is not
  if (!(x == undefined) != !(y == undefined)) {
    return false;
  }
  if (x === y) {
    return true;
  }
  if (x.length != y.length) {
    return false;
  }
  for (let key in x) {
    let xHasKey = x.hasOwnProperty(key);
    let yHasKey = y.hasOwnProperty(key);
    if (!xHasKey) {
      continue;
    }
    if(!xHasKey != !yHasKey) {
      return false;
    }
    // recursive call in case of a nested array
    if (!compareArray(x[key], y[key])) {
      return false;
    }
  }
  return true;
}

function mergeArrays(x, y) {
  let result = [];
  if (x && y) {
    for (let i = 0; i < x.length; i++) {
      let a = x[i]
      if (y.indexOf(a) == -1) {
        result.push(a);
      }
    }
    result = [...new Set([...result, ...y])];
  }
  else if (x) {
    result = x;
  }
  else if (y) {
    result = y;
  }
  else {
    result = [];
  }
  return result;
}

function showActor(actor, animate, time, onCompleteCallback) {
  if (!actor.visible) {
    let width = actor.width;
    if (!animate || time == 0) {
      actor.show();
    }
    else {
      actor.natural_width = 0;
      actor.show();
      Tweener.addTween(actor, {
        natural_width: width,
        time: time,
        transition: "easeInOutQuad",
        onComplete: Lang.bind(this, function() {
          if (onCompleteCallback) {
            onCompleteCallback();
          }
        })
      });
    }
  }
}

function hideActor(actor, animate, time, onCompleteCallback) {
  if (actor.visible) {
    let width = actor.natural_width;
    if (animate && time > 0) {
      Tweener.addTween(actor, {
        natural_width: 0,
        time: time,
        transition: "easeInOutQuad",
        onComplete: Lang.bind(this, function () {
          actor.hide();
          actor.natural_width = width;
          if (onCompleteCallback) {
            onCompleteCallback();
          }
        })
      });
    }
    else {
      actor.hide();
    }
  }
}

function CobiWindowListSettings(instanceId) {
  this._init(instanceId);
}

CobiWindowListSettings.prototype = {
  __proto__: Settings.AppletSettings.prototype,
  
  _init: function(instanceId) {
    Settings.AppletSettings.prototype._init.call(this, this, UUID, instanceId);
  },
  
  _saveToFile: function() {
    if (!this.monitorId) {
      this.monitorId = this.monitor.connect("changed", Lang.bind(this, this._checkSettings));
    }
    let rawData = JSON.stringify(this.settingsData, null, 4);
    let raw = this.file.replace(null, false, Gio.FileCreateFlags.NONE, null);
    let out_file = Gio.BufferedOutputStream.new_sized(raw, 4096);
    Cinnamon.write_string_to_stream(out_file, rawData);
    out_file.close(null);
  },
    
  setValue: function(key, value) {
    if (!(key in this.settingsData)) {
      key_not_found_error(key, this.uuid);
      return;
    }
    if (!compareArray(this.settingsData[key].value, value)) {
      this._setValue(value, key);
    }
  },
  
  destroy: function() {
    this.finalize();
  }
}

function CobiPopupMenuItem(menu, appButton, metaWindow) {
  this._init(menu, appButton, metaWindow);
}

CobiPopupMenuItem.prototype = {
  __proto__: PopupMenu.PopupBaseMenuItem.prototype,
  
  _init: function(menu, appButton, metaWindow) {
    PopupMenu.PopupBaseMenuItem.prototype._init.call(this);
    this._menu = menu;
    this._appButton = appButton;
    this._metaWindow = metaWindow;
    this._signalManager = new SignalManager.SignalManager(this);
    
    this._box = new St.BoxLayout({vertical: true, reactive: true});
    this._descBox = new St.BoxLayout();
    this._label = new St.Label();
    
    this.addActor(this._box);
    this._box.add_actor(this._descBox);
    this._iconSize = 20 * global.ui_scale;
    let descSize = 30 * global.ui_scale;
    let icon = this._appButton._app ?
                  this._appButton._app.create_icon_texture(this._iconSize) :
                  new St.Icon({ icon_name: "application-default-icon",
                                icon_type: St.IconType.FULLCOLOR,
                                icon_size: this._iconSize });
    let windowActor = metaWindow.get_compositor_private();
    let monitor = Main.layoutManager.findMonitorForActor(windowActor);
    let width = monitor.width;
    let height = monitor.height;
    let aspectRatio = width / height;
    height = Math.round(height / 10);
    width = Math.round(height * aspectRatio);
    this._iconBin = new St.Bin({natural_width: descSize, natural_height: descSize});
    this._descBox.add_actor(this._iconBin);
    this._iconBin.set_child(icon);
    
    this._label = new St.Label();
    let text = this._metaWindow.get_title();
    if (!text) {
      text = this._appButton._app.get_name();
    }
    if (!text) {
      text = "?";
    }
    this._label.set_text(text);
    this._labelBin = new St.Bin({natural_width: width - (2 * descSize)});
    this._labelBin.set_alignment(St.Align.START, St.Align.MIDDLE);
    this._descBox.add_actor(this._labelBin);
    this._labelBin.add_actor(this._label);
    this._closeBin = new St.Bin({natural_width: descSize, height: descSize});
    this._closeIcon = new St.Bin({style_class: "window-close", natural_width: this._iconSize, height: this._iconSize});
    this._descBox.add_actor(this._closeBin);
    this._closeBin.set_child(this._closeIcon);
    this._closeIcon.hide();
    
    if (!Main.software_rendering) {
      this._cloneBox = new St.Widget({natural_width: width, height: height});
      this._box.add_actor(this._cloneBox);
      let clones = WindowUtils.createWindowClone(this._metaWindow, width, height, true, true);
      for (let i = 0; i < clones.length; i++) {
        let clone = clones[i];
        this._cloneBox.add_actor(clone.actor);
        clone.actor.set_position(clone.x, clone.y);
      }
    }
    this._signalManager.connect(this.actor, "enter-event", this._onEnterEvent);
    this._signalManager.connect(this.actor, "leave-event", this._onLeaveEvent);
    this._signalManager.connect(this, "activate", this._onClick);
  },
  
  _onEnterEvent: function() {
    if (this._closeIcon instanceof St.Bin) {
      // fetch the css icon here, so we don't mess with "not in the stage" in the constructor"
      let icon = St.TextureCache.get_default().load_file_simple(this._closeIcon.get_theme_node().get_background_image());
      icon.natural_width = this._iconSize;
      icon.natural_height = this._iconSize;
      this._closeBin.set_child(null);
      this._closeIcon = icon;
      this._closeIcon.set_reactive(true);
      this._closeBin.set_child(this._closeIcon);
      this._signalManager.connect(this._closeIcon, "button-release-event", this._onClose);
    }
    this._closeIcon.show();
  },
  
  _onLeaveEvent: function() {
    this._closeIcon.hide();
  },
  
  _onClose: function() {
    this._inClosing = true;
    this._metaWindow.delete(global.get_current_time());
    this._inClosing = false;
    return true;
  },
  
  _onClick: function() {
    if (!this._inClosing) {
      Main.activateWindow(this._metaWindow);
    }
  },
  
  hide: function() {
    this._menu._inHiding = true;
    hideActor(this._label, true, ANIMATION_TIME);
    this._closeBin.hide();
    hideActor(this.actor, true, ANIMATION_TIME, Lang.bind(this, function() {
      this._menu._inHiding = false;
      this.destroy();
    }));
  },
  
  destroy: function() {
    this._signalManager.disconnectAllSignals();
    PopupMenu.PopupBaseMenuItem.prototype.destroy.call(this);
  },
}

function CobiPopupMenu(appButton) {
  this._init(appButton);
}

CobiPopupMenu.prototype = {
  __proto__: PopupMenu.PopupMenu.prototype,
  
  _init: function(appButton) {
    PopupMenu.PopupMenu.prototype._init.call(this, appButton.actor, appButton._applet.orientation);
    this._appButton = appButton;
    this._settings = this._appButton._settings;
    this._signalManager = new SignalManager.SignalManager(this);
    
    this._windows = [];
    
    global.focus_manager.add_group(this.actor);
    this.actor.reactive = true;
    //Main.uiGroup.add_actor(this.actor);
    Main.layoutManager.addChrome(this.actor);
    this.actor.hide();
    
    this._updateOrientation();
    
    this._signalManager.connect(this.actor, "enter-event", this._onEnterEvent);
    this._signalManager.connect(this.actor, "leave-event", this._onLeaveEvent);
  },
  
  _updateOrientation: function() {
    if (!Main.software_rendering) {
      this.box.set_vertical(false);
    }
    
    if (this._appButton._applet.orientation == St.Side.LEFT || this._appButton._applet.orientation == St.Side.LEFT) {
      this.box.set_vertical(true);
    }
  },
  
  removeDelay: function() {
    if (this._delayId) {
      let doIt = GLib.MainContext.default().find_source_by_id(this._delayId);
      if (doIt) {
        Mainloop.source_remove(this._delayId);
      }
      this._delayId = null;
    }
  },
  
  openDelay: function() {
    this.removeDelay();
    this._delayId = Mainloop.timeout_add(this._settings.getValue("preview-timeout-show"), Lang.bind(this, this.open));
  },
  
  closeDelay: function() {
    this.removeDelay();
    this._delayId = Mainloop.timeout_add(this._settings.getValue("preview-timeout-hide"), Lang.bind(this, function() {
      this.close();
    }));
  },
  
  _onEnterEvent: function() {
    this.removeDelay();
    return false;
  },
  
  _onLeaveEvent: function() {
    this.closeDelay();
    return false;
  },
  
  _findMenuItemForWindow: function(metaWindow) {
    let items = this._getMenuItems();
    items = items.filter(function(item) {
      return item._metaWindow == metaWindow;
    });
    if (items.length > 0) {
      return items[0];
    }
    return null;
  },
  
  open: function() {
    if (this.isOpen) {
      return;
    }
    let windows = this._appButton.getWindowsOnCurrentWorkspace();
    for (let i = 0; i < windows.length; i++) {
      let window = windows[i];
      this.addMenuItem(new CobiPopupMenuItem(this, this._appButton, window));
    }
    PopupMenu.PopupMenu.prototype.open.call(this, false);
  },
  
  close: function() {
    if (this._inHiding && this.numMenuItems > 1) {
      return;
    }
    this.removeDelay();
    PopupMenu.PopupMenu.prototype.close.call(this, false);
    this.removeAll();
    this._windows = [];
  },
  
  addWindow: function(metaWindow) {
    if (this._findMenuItemForWindow(metaWindow) == null) {
      this.addMenuItem(new CobiPopupMenuItem(this, this._appButton, metaWindow));
    }
  },
  
  removeWindow: function(metaWindow) {
    let item = this._findMenuItemForWindow(metaWindow);
    if (item) {
      item.hide();
    }
  },
  
  destroy: function() {
    this._signalManager.disconnectAllSignals();
    PopupMenu.PopupMenu.prototype.destroy.call(this);
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
    this._settings = this._applet._settings;
    this._signalManager = new SignalManager.SignalManager(this);
    
    this.actor = new Cinnamon.GenericContainer({
                                         track_hover: true,
                                         can_focus: true,
                                         reactive: true
    });
    this._updateOrientation();
    this._buttonContainer = new St.BoxLayout();
    this.actor.add_actor(this._buttonContainer);
    
    this._labelNumber = new St.Label();
    this.actor.add_actor(this._labelNumber);
    
    this._label = new St.Label({natural_width: this._settings.getValue("label-width")});
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
    
    this._contextMenuManager = new PopupMenu.PopupMenuManager(this);
    this.menu = new CobiPopupMenu(this);
    this._contextMenu = new Applet.AppletPopupMenu(this, this._applet.orientation);
    this._contextMenuManager.addMenu(this._contextMenu);
    
    this._signalManager.connect(this.actor, "button-release-event", this._onButtonRelease);
    this._signalManager.connect(this._settings, "changed::caption-type", this._updateLabel);
    this._signalManager.connect(this._settings, "changed::display-caption-for", this._updateLabelVisibility);
    this._signalManager.connect(this._settings, "changed::display-number", this._updateNumber);
    this._signalManager.connect(this._settings, "changed::label-width", this._updateLabel);
    this._signalManager.connect(this.actor, "enter-event", this._onEnterEvent);
    this._signalManager.connect(this.actor, "leave-event", this._onLeaveEvent);
    this._signalManager.connect(this.actor, "get-preferred-width", this._getContentPreferredWidth);
    this._signalManager.connect(this.actor, "get-preferred-height", this._getContentPreferredHeight);
    this._signalManager.connect(this.actor, "allocate", this._allocateContent);
    this._signalManager.connect(Main.themeManager, "theme-set", Lang.bind(this, function() {
      this.actor.remove_style_pseudo_class("neutral");
      this.updateView();
    }));
    
    /*
    this._draggable = DND.makeDraggable(this.actor);
    this._draggable.connect('drag-begin', Lang.bind(this, this._onDragBegin));
    this._draggable.connect('drag-cancelled', Lang.bind(this, this._onDragCancelled));
    this._draggable.connect('drag-end', Lang.bind(this, this._onDragEnd));
    */
  },
  
  /*
  _onDragBegin: function() {
    this._tooltip.hide();
    this._tooltip.preventShow = true;
    if (this.menu.isOpen) {
      this.menu.close();
    }
  },
  
  _onDragCancelled: function() {
    this._updateTooltip();
  },
  
  _onDragEnd: function() {
    this._updateTooltip();
  },
  */
  
  getPinnedIndex: function() {
    return this._settings.getValue("pinned-apps").indexOf(this._app.get_id());
  },
  
  isPinned: function() {
    return this.getPinnedIndex() >= 0;
  },
  
  addWindow: function(metaWindow) {
    this._windows.push(metaWindow);
    if (this.menu.isOpen) {
      this.menu.addWindow(metaWindow);
    }
    this._updateCurrentWindow();
    this._updateNumber();
    this._updateLabel();
    
    this._signalManager.connect(metaWindow, "notify::title", this._updateLabel);
    this._signalManager.connect(metaWindow, "notify::minimized", this._onMinimized);
    this._signalManager.connect(metaWindow, "notify::urgent", this._updateUrgentState);
    this._signalManager.connect(metaWindow, "notify::demands-attention", this._updateUrgentState);
    
    this.actor.remove_style_pseudo_class("neutral");
    this._updateTooltip();
    let wsWindows = this.getWindowsOnCurrentWorkspace();
    if (wsWindows.length == 1) {
      this._applet.menuManager.addMenu(this.menu);
    }
  },
  
  removeWindow: function(metaWindow) {
    this._signalManager.disconnect("notify::title", metaWindow);
    this._signalManager.disconnect("notify::minimized", metaWindow);
    this._signalManager.disconnect("notify::urgent", metaWindow);
    this._signalManager.disconnect("notify::demands-attention", metaWindow);
    
    let arIndex = this._windows.indexOf(metaWindow);
    if (arIndex >= 0) {
      this._windows.splice(arIndex, 1);
      this._updateCurrentWindow();
      if (this.menu.isOpen) {
        this.menu.removeWindow(metaWindow);
      }
    }
    if (this.isPinned()) {
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
    let screen = global.screen;
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
    this._tooltip.preventShow = this.getWindowsOnCurrentWorkspace().length > 0;
  },
  
  updateIcon: function() {
    let panelHeight = this._applet._panelHeight;
    if (this._applet._scaleMode) {
      this.iconSize = Math.round(panelHeight * ICON_HEIGHT_FACTOR);
    }
    else {
      this.iconSize = ((panelHeight - 4) > DEFAULT_ICON_SIZE) ? DEFAULT_ICON_SIZE : MINIMUM_ICON_SIZE;
    }
    
    let icon = this._app ?
            this._app.create_icon_texture(this.iconSize) :
            new St.Icon({ icon_name: "application-default-icon",
                icon_type: St.IconType.FULLCOLOR,
                icon_size: this.iconSize });
    
    this._icon = icon;
    this._iconBox.set_child(this._icon);
    // let the difference between icon size and panel height be even
    // so that the icon can be exactly vertically centered inside the box
    if ((panelHeight - this.iconSize) & 1) {
      panelHeight++;
    }
    this._iconBox.set_width(panelHeight);
    this._iconBox.set_height(panelHeight);
  },
  
  updateCaption: function() {
    this._updateLabel();
    this._updateLabelVisibility();
  },
  
  _updateNumber: function() {
    let setting = this._settings.getValue("display-number");
    let text = "";
    let number = this.getWindowsOnCurrentWorkspace().length;
    if (((setting == CobiDisplayNumber.All && number >= 1)    ||
         (setting == CobiDisplayNumber.Smart && number >= 2)) &&
        this._settings.getValue("group-windows")) {
      text += number;
    }
    this._labelNumber.set_text(text);
  },
  
  _updateLabel: function() {
    let captionType = this._settings.getValue("caption-type");
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
    this._label.natural_width = this._settings.getValue("label-width");
  },
  
  _updateLabelVisibility: function() {
    if (this._inhibitLabel) {
      hideActor(this._labelBox, false);
    }
    let value = this._settings.getValue("display-caption-for");
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
  
  _updateVisualState: function() {
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
  
  _updateOrientation: function() {
    switch (this.orientation) {
      case St.Side.LEFT:
        this.actor.set_style_class_name("window-list-item-box left");
        this.actor.set_style("margin-left 0px; padding-left: 0px; padding-right: 0px; margin-right: 0px;");
        this._inhibitLabel = true;
        break;
      case St.Side.RIGHT:
        this.actor.set_style_class_name("window-list-item-box right");
        this.actor.set_style("margin-left: 0px; padding-left: 0px; padding-right: 0px; margin-right: 0px;");
        this._inhibitLabel = true;
        break;
      case St.Side.TOP:
        this.actor.set_style_class_name("window-list-item-box top");
        this.actor.set_style("margin-top: 0px; padding-top: 0px;");
        this._inhibitLabel = false;
        break;
      case St.Side.BOTTOM:
        this.actor.set_style_class_name("window-list-item-box bottom");
        this.actor.set_style("margin-bottom: 0px; padding-bottom: 0px;");
        this._inhibitLabel = false;
        break;
    }
  },
  
  hasWindowsOnWorkspace: function() {
    let index = global.screen.get_active_workspace_index();
    return this._windows.some(function(win) {
      return win.is_on_all_workspaces() || win.get_workspace().index() == index;
    });
  },
  
  _updateUrgentState: function() {
    let wsWindows = this.getWindowsOnCurrentWorkspace();
    let state = wsWindows.some(function(win) {
      return win.urgent || win.demands_attention;
    });
    
    if (state) {
      /*
      this.actor.set_hover(false);
      this.actor.set_track_hover(false);
      */
      this.actor.add_style_class_name("window-list-item-demands-attention");
    }
    else {
      //this.actor.set_track_hover(true);
      this.actor.remove_style_class_name("window-list-item-demands-attention");
    }
  },
  
  _updateFocus: function() {
    let wsWindows = this.getWindowsOnCurrentWorkspace();
    for (let i = 0; i < wsWindows.length; i++) {
      let metaWindow = wsWindows[i];
      if (_hasFocus(metaWindow) && !metaWindow.minimized) {
        this.actor.add_style_pseudo_class("focus");
        this._currentWindow = metaWindow;
        this._updateLabel();
        break;
      }
      else {
        this.actor.remove_style_pseudo_class("focus");
      }
    }
    this._updateUrgentState();
    this.updateCaption();
  },
  
  _updateVisibility: function() {
    if (this.hasWindowsOnWorkspace()) {
      showActor(this.actor, false);
    }
    else if (this.isPinned()) {
      showActor(this.actor, false);
    }
    else {
      hideActor(this.actor, false);
    }
  },
  
  updateView: function() {
    this._updateCurrentWindow();
    this._updateVisualState();
    this._updateNumber();
    this._updateFocus();
    this._updateVisibility();
    this._updateTooltip();
  },
  
  demandAttention: function(metaWindow) {
  },
  
  destroy: function() {
    this._signalManager.disconnectAllSignals();
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
    this._tooltip.hide();
    this._tooltip.destroy();
    this._tooltip = null;
    this._app = null;
    this.menu.destroy();
    this._applet.menuManager.removeMenu(this.menu);
    this.menu = null;
    this._contextMenu.destroy();
    this._contextMenuManager.removeMenu(this._contextMenu);
    this._contextMenu = null;
    this._applet = null;
    this._settings = null;
  },
  
  _onButtonRelease: function(actor, event) {
    this.menu.removeDelay();
    if (this._contextMenu.isOpen) {
      this._contextMenu.close();
    }
    if (this.menu.isOpen) {
      this.menu.close();
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
    let animationTime = this._settings.getValue("animation-time") / 1000;
    this._animateIcon(animationTime);
  },
  
  _onEnterEvent: function() {
    let wsWindows = this.getWindowsOnCurrentWorkspace();
    let state = wsWindows.some(function(win) {
      return win.urgent || win.demands_attention;
    });
    if (state) {
      //this.actor.remove_style_class_name("window-list-item-demands-attention");
      this.actor.set_track_hover(false);
      this.actor.set_hover(false);
      //this.actor.add_style_class_name("window-list-item-demands-attention");
      //this.actor.queue_redraw();
    }
    if (this.getWindowsOnCurrentWorkspace().length > 0) {
      this.menu.openDelay();
    }
  },
  
  _onLeaveEvent: function() {
    if (this.getWindowsOnCurrentWorkspace().length > 0) {
      this.menu.closeDelay();
    }
    this.actor.set_track_hover(true);
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
    this._contextMenu.addAction(_("Settings"), Lang.bind(this, function() {this._applet.configureApplet();}));
    this._contextMenu.addAction(_("Remove this applet"), Lang.bind(this, function() {
      AppletManager._removeAppletFromPanel(this._applet._uuid, this._applet.instance_id);
    }));
    
    
    // app-wide
    this._contextMenu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    this._contextMenu.addAction(_("Open new window"), Lang.bind(this, this._startApp));
    
    if (this._settings.getValue("display-pinned")) {
      if (this.isPinned()) {
        this._contextMenu.addAction(_("Remove from favorites"), Lang.bind(this, function() {
          this._applet.unpinApp(this);
        }));
      }
      else {
        this._contextMenu.addAction(_("Add to favorites"), Lang.bind(this, function() {
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

function CobiWindowList(orientation, panelHeight, instanceId) {
  this._init(orientation, panelHeight, instanceId);
}

CobiWindowList.prototype = {
  __proto__: Applet.Applet.prototype,
  
  _init: function(orientation, panelHeight, instanceId) {
    Applet.Applet.prototype._init.call(this, orientation, panelHeight, instanceId);
    this.setAllowedLayout(Applet.AllowedLayout.BOTH);
    
    this.actor.set_hover(false);
    this.actor.set_track_hover(false);
    this.actor.add_style_class_name("window-list-box");
    this.orientation = orientation;
    
    this.dragInProgress = false;
    
    this._windowTracker = Cinnamon.WindowTracker.get_default();
    this._appSys = Cinnamon.AppSystem.get_default();
    
    this.menuManager = new PopupMenu.PopupMenuManager(this);
    
    this._appButtons = [];
    this._settings = new CobiWindowListSettings(instanceId);
    this._signalManager = new SignalManager.SignalManager(this);
    
    //this.actor.reactive = global.settings.get_boolean("panel-edit-mode");
    this.on_orientation_changed(orientation);
    
    this._workspaces = [];
  },
  
  _onButtonReleaseEvent: function (actor, event) {
    // override applet's default context menu toggling
  },
  
  _onButtonPressEvent: function() {
    // override applet's default context menu toggling
  },
  
  on_applet_added_to_panel: function() {
    if (this._settings.getValue("display-pinned")) {
      this._updatePinnedApps();
    }
    this._onWorkspacesChanged();
    this.emit("connect-signals");
    
    this._signalManager.connect(global.window_manager, "switch-workspace", this._updateAppButtonVisibility);
    this._signalManager.connect(global.settings, "changed::panel-edit-mode", this._on_panel_edit_mode_changed);
    this._signalManager.connect(global.screen, "notify::n-workspaces", this._onWorkspacesChanged);
    this._signalManager.connect(this._windowTracker, "notify::focus-app", this._updateFocus);
    this._signalManager.connect(this._settings, "changed::pinned-apps", this._updatePinnedApps);
    this._signalManager.connect(this._settings, "changed::display-pinned", this._onDisplayPinnedChanged);
    this._signalManager.connect(this._settings, "changed::group-windows", this._onGroupingChanged);
  },
  
  on_applet_removed_from_panel: function() {
    this._signalManager.disconnectAllSignals();
    this.emit("disconnect-signals");
  },
  
  _on_panel_edit_mode_changed: function () {
    let panelEditMode = global.settings.get_boolean("panel-edit-mode");
    if (panelEditMode) {
      this.actor.set_track_hover(true);
    }
    else {
      this.actor.set_hover(false);
      this.actor.set_track_hover(false);
    }
    //this.actor.reactive = panelEditMode;
  },
  
  on_panel_height_changed: function() {
    for (let i in this._appButtons) {
      this._appButtons[i].updateIcon();
    }
  },
  
  on_orientation_changed: function(orientation) {
    this.orientation = orientation;
    if (orientation == St.Side.TOP || orientation == St.Side.BOTTOM) {
      this.actor.set_vertical(false);
      this.actor.remove_style_class_name("vertical");
      this.actor.set_style("margin-bottom: 0px; padding-bottom: 0px;");
    }
    else {
      this.actor.set_vertical(true);
      this.actor.add_style_class_name("vertical");
      this.actor.set_style("margin-right: 0px; padding-right: 0px; padding-left: 0px; margin-left: 0px;");
      //this.actor.set_x_align(Clutter.ActorAlign.CENTER);
      //this.actor.set_important(true);
    }
    for (let i = 0; i < this._appButtons.length; i++) {
      let appButton = this._appButtons[i];
      appButton._updateOrientation();
    }
  },
  
  _addAppButton: function(app) {
    if (!app) {
      return undefined;
    }
    let appButton = new CobiAppButton(this, app, this.orientation);
    this._appButtons.push(appButton);
    this.actor.add_actor(appButton.actor);
    appButton.updateIcon();
    showActor(appButton.actor, false);
    appButton.updateCaption();
    return appButton;
  },
  
  _removeAppButton: function(appButton) {
    let index = this._appButtons.indexOf(appButton);
    if (index >= 0) {
      this._appButtons.splice(index, 1);
      //this.actor.remove_actor(appButton.actor);
      appButton.destroy();
    }
  },
  
  _lookupAppButtonForWindow: function(metaWindow) {
    let appButtons = this._appButtons.filter(function(appButton) {
      return appButton._windows.indexOf(metaWindow) >= 0;
    });
    return appButtons.length > 0 ? appButtons[0] : undefined;
  },
  
  _lookupAllAppButtonsForApp: function(app) {
    return this._appButtons.filter(function(appButton) {
      return appButton._app == app;
    });
  },
  
  _lookupAppButtonForApp: function(app) {
    let appButtons = this._lookupAllAppButtonsForApp(app);
    return appButtons.length > 0 ? appButtons[0] : undefined;
  },
  
  _onWorkspacesChanged: function() {
    for (let i in this._workspaces) {
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
    if (!app) {
      app = this._windowTracker.get_app_from_pid(metaWindow.get_pid());
    }
    if (this._lookupAppButtonForWindow(metaWindow)) {
      return;
    }
    let appButton = this._lookupAppButtonForApp(app);
    if (!appButton) {
      appButton = this._addAppButton(app);
    }
    else if (!this._settings.getValue("group-windows") && appButton._windows.length > 0) {
      appButton = this._addAppButton(app);
    }
    appButton.addWindow(metaWindow);
    this._updateAppButtonVisibility();
  },
  
  _windowRemoved: function(metaWorkspace, metaWindow) {
    let appButton = this._lookupAppButtonForWindow(metaWindow);
    if (appButton) {
      let remove = true;
      appButton.removeWindow(metaWindow);
      if (appButton._windows.length > 0 || (this._settings.getValue("display-pinned") && appButton.isPinned())) {
        remove = false;
      }
      if (remove) {
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
      let pinnedApps = this._settings.getValue("pinned-apps");
      let prevPinnedAppButton = null;
      // find new pinned apps
      for (let i = 0; i < pinnedApps.length; i++) {
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
          let prevActorIndex = this.actor.get_children().indexOf(prevPinnedAppButton.actor);
          let appButtonActorIndex = this.actor.get_children().indexOf(appButton.actor);
          for (let i = prevActorIndex + 1; i < appButtonActorIndex; i++) {
            let checkAppButton = this.actor.get_child_at_index(i)._delegate;
            let checkAppButtonPinnedIndex = checkAppButton.getPinnedIndex();
            if (checkAppButtonPinnedIndex >= 0) {
              actorIndex = checkAppButtonPinnedIndex - 1;
            }
          }
        }
        else {
        }
        if (actorIndex >= 0) {
          this.actor.move_child(appButton.actor, actorIndex);
        }
        
        prevPinnedAppButton = appButton;
      }
    }
    
    for (let i = this._appButtons.length - 1; i >= 0; i--) {
      let appButton = this._appButtons[i];
      if (!(appButton.isPinned()) && appButton._windows.length == 0) {
        this._removeAppButton(appButton);
      }
    }
  },
  
  _onDisplayPinnedChanged: function() {
    let setting = this._settings.getValue("display-pinned");
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
    let setting = this._settings.getValue("pinned-apps").slice();
    if (setting.indexOf(appId) >= 0) {
      this.isPinning = false;
      return;
    }
    let pinIndex = 0;
    let actorList = this.actor.get_children();
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
    let setting = this._settings.getValue("pinned-apps").slice();
    let settingIndex = setting.indexOf(appId);
    if (settingIndex >= 0) {
      setting.splice(settingIndex, 1);
      this._settings.setValue("pinned-apps", setting);
    }
    this.isPinning = false;
  },
  
  _onGroupingChanged: function() {
    let setting = this._settings.getValue("group-windows");
    if (setting) {
      this._group();
    }
    else {
      this._ungroup();
    }
  },
  
  _group: function() {
    let appButtons = this._appButtons.slice();
    for (let i = 0; i < appButtons.length; i++) {
      let appButton = appButtons[i];
      let app = appButton._app;
      let allButtons = this._lookupAllAppButtonsForApp(app);
      for (let j = 1; j < allButtons.length; j++) {
        let btn = allButtons[j];
        for (let k = 0; k < btn._windows.length; k++) {
          let window = btn._windows[k];
          /*
          btn.removeWindow(window);
          appButton.addWindow(window);
          */
          this._windowRemoved(null, window);
          this._windowAdded(null, window);
        }
        this._removeAppButton(btn);
      }
    }
    for (let i = 0; i < this._appButtons.length; i++) {
      appButtons[i].updateView();
    }
    this._updatePinnedApps();
  },
  
  _ungroup: function() {
    let appButtons = this._appButtons.slice();
    for (let i = 0; i < appButtons.length; i++) {
      let appButton = appButtons[i];
      for (let j = appButton._windows.length - 1; j >= 0; j--) {
        let window = appButton._windows[j];
        if (window != appButton._currentWindow) {
          appButton.removeWindow(window);
          let btn = this._addAppButton(appButton._app);
          btn.addWindow(window);
        }
      }
      appButton.updateView();
    }
    this._updatePinnedApps();
  },
  
  _updateAppButtonVisibility: function() {
    for (let i = 0; i < this._appButtons.length; i++) {
      let appButton = this._appButtons[i];
      appButton.updateView();
    }
    this.actor.queue_relayout();
  },
  
  _updateFocus: function() {
    for (let i = 0; i < this._appButtons.length; i++) {
      let appButton = this._appButtons[i];
      appButton._updateFocus();
    }
  },

  makeVectorBox: function(actor) {
    this.destroyVectorBox(actor);
    let [mx, my, mask] = global.get_pointer();
    let [bx, by] = this.categoriesApplicationsBox.actor.get_transformed_position();
    let [bw, bh] = this.categoriesApplicationsBox.actor.get_transformed_size();
    let [aw, ah] = actor.get_transformed_size();
    let [ax, ay] = actor.get_transformed_position();
    let [appbox_x, appbox_y] = this.applicationsBox.get_transformed_position();

    let right_x = appbox_x - bx;
    let xformed_mouse_x = mx-bx;
    let xformed_mouse_y = my-by;
    let w = Math.max(right_x-xformed_mouse_x, 0);

    let ulc_y = xformed_mouse_y + 0;
    let llc_y = xformed_mouse_y + 0;

    this.vectorBox = new St.Polygon({debug: false, width: w, height: bh,
                                     ulc_x: 0, ulc_y: ulc_y,
                                     llc_x: 0, llc_y: llc_y,
                                     urc_x: w, urc_y: 0,
                                     lrc_x: w, lrc_y: bh});

    this.categoriesApplicationsBox.actor.add_actor(this.vectorBox);
    this.vectorBox.set_position(xformed_mouse_x, 0);

    this.vectorBox.show();
    this.vectorBox.set_reactive(true);
    this.vectorBox.raise_top();

    this.vectorBox.connect("leave-event", Lang.bind(this, this.destroyVectorBox));
    this.vectorBox.connect("motion-event", Lang.bind(this, this.maybeUpdateVectorBox));
    this.actor_motion_id = actor.connect("motion-event", Lang.bind(this, this.maybeUpdateVectorBox));
    this.current_motion_actor = actor;
  },

  maybeUpdateVectorBox: function() {
    if (this.vector_update_loop) {
      Mainloop.source_remove(this.vector_update_loop);
      this.vector_update_loop = 0;
    }
    this.vector_update_loop = Mainloop.timeout_add(35, Lang.bind(this, this.updateVectorBox));
  },

  updateVectorBox: function(actor) {
    if (this.vectorBox) {
      let [mx, my, mask] = global.get_pointer();
      let [bx, by] = this.categoriesApplicationsBox.actor.get_transformed_position();
      let xformed_mouse_x = mx-bx;
      let [appbox_x, appbox_y] = this.applicationsBox.get_transformed_position();
      let right_x = appbox_x - bx;
      if ((right_x-xformed_mouse_x) > 0) {
        this.vectorBox.width = Math.max(right_x-xformed_mouse_x, 0);
        this.vectorBox.set_position(xformed_mouse_x, 0);
        this.vectorBox.urc_x = this.vectorBox.width;
        this.vectorBox.lrc_x = this.vectorBox.width;
        this.vectorBox.queue_repaint();
      }
      else {
        this.destroyVectorBox(actor);
      }
    }
    this.vector_update_loop = 0;
    return false;
  },

  destroyVectorBox: function(actor) {
    if (this.vectorBox != null) {
      this.vectorBox.destroy();
      this.vectorBox = null;
    }
    if (this.actor_motion_id > 0 && this.current_motion_actor != null) {
      this.current_motion_actor.disconnect(this.actor_motion_id);
      this.actor_motion_id = 0;
      this.current_motion_actor = null;
    }
  }
}

Signals.addSignalMethods(CobiWindowList.prototype);

function main(metadata, orientation, panelHeight, instanceId) {
  return new CobiWindowList(orientation, panelHeight, instanceId);
}
