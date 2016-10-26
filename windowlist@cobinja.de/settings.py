#! /usr/bin/env python3
#
# settings.py
# Copyright (C) 2013 Lars Mueller <cobinja@yahoo.de>
# 
# CobiWindowList is free software: you can redistribute it and/or modify it
# under the terms of the GNU General Public License as published by the
# Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
# 
# CobiWindowList is distributed in the hope that it will be useful, but
# WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
# See the GNU General Public License for more details.
# 
# You should have received a copy of the GNU General Public License along
# with this program.  If not, see <http://www.gnu.org/licenses/>.

import gi
gi.require_version('Gtk', '3.0')
from gi.repository import Gtk, GLib, Gio, GObject
import os, sys
import json
import collections

APPLET_DIR = os.path.dirname(os.path.abspath(__file__))
UI_FILE = APPLET_DIR + "/settings.ui"

UUID = "windowlist@cobinja.de"

class CobiCaptionType:
  Name = 0
  Title = 1

class CobiDisplayCaption :
  No = 0
  All = 1
  Running = 2
  Focused = 3

class CobiDisplayNumber :
  No = 0
  All = 1
  Smart = 2

class CobiGroupWindows :
  No = 0
  All = 1
  Smart = 2

class CobiSettings:
  def __init__(self, instanceId):
    self.instanceId = instanceId
    settingsDirName = GLib.get_user_config_dir()
    if not settingsDirName:
      settingsDirName = GLib.get_home_dir() + "/.config"
    settingsDirName += "/cobinja/" + UUID
    settingsDir = Gio.file_new_for_path(settingsDirName)
    
    if not settingsDir.query_exists(None):
      settingsDir.make_directory_with_parents(None)
    
    self.__settingsFile = settingsDir.get_child(instanceId + ".json")
    if not self.__settingsFile.query_exists(None):
      self.__getDefaultSettingsFile().copy(self.__settingsFile, 0, None, None, None)
    
    self.values = collections.OrderedDict()
    
    self.__loadSettings()
    
    self.__monitor = self.__settingsFile.monitor(Gio.FileMonitorFlags.NONE, None)
    self.__monitorChangedId = self.__monitor.connect("changed", self.__onSettingsChanged)
  
  def __getDefaultSettingsFile(self):
    return Gio.file_new_for_path(APPLET_DIR + "/default_settings.json")
  
  def writeSettings(self):
    if self.changed():
      f = open(self.__settingsFile.get_path(), 'w')
      f.write(json.dumps(self.values, sort_keys=False, indent=2))
      f.close()
      self.__origSettings = collections.OrderedDict(self.values)
  
  def setEntry(self, key, value, writeToFile):
    if key in self.values.keys() and self.values[key] != value:
      self.values[key] = value
      if writeToFile:
        self.writeSettings()
  
  def __onSettingsChanged(self, monitor, thisFile, otherFile, eventType):
    self.__loadSettings()
  
  def __loadSettings(self):
    f = open(self.__settingsFile.get_path(), 'r')
    settings = json.loads(f.read(), object_pairs_hook=collections.OrderedDict)
    f.close()
    for key in settings:
      value = settings[key]
      oldValue = self.values[key] if key in self.values.keys() else None
      if value != oldValue:
        self.values[key] = value
    self.__origSettings = collections.OrderedDict(self.values)
  
  def changed(self):
    return self.values != self.__origSettings
  
  def __del__(self):
    self.__monitor.disconnect(self.__monitorChangedId)
    self.__monitor.cancel()

class CobiWindowListSettings:
  def __init__(self):
    instanceId = sys.argv[1];
    self.__settings = CobiSettings(instanceId)
    
    self.builder = Gtk.Builder()
    self.builder.add_from_file(UI_FILE)
    self.builder.connect_signals(self)
    
    self.lsCaptionType = Gtk.ListStore(GObject.TYPE_INT, GObject.TYPE_STRING)
    self.lsCaptionType.append([CobiCaptionType.Name, "Name"])
    self.lsCaptionType.append([CobiCaptionType.Title, "Title"])
    cbCaptionType = self.builder.get_object("cbCaptionType")
    cbCaptionType.set_model(self.lsCaptionType)
    cell = Gtk.CellRendererText()
    cbCaptionType.pack_start(cell, True)
    cbCaptionType.add_attribute(cell, "text", 1)
    cbCaptionType.set_active(self.__settings.values["caption-type"])
    
    self.lsDisplayCaption = Gtk.ListStore(GObject.TYPE_INT, GObject.TYPE_STRING)
    self.lsDisplayCaption.append([CobiDisplayCaption.No, "None"])
    self.lsDisplayCaption.append([CobiDisplayCaption.All, "All"])
    self.lsDisplayCaption.append([CobiDisplayCaption.Running, "Running"])
    self.lsDisplayCaption.append([CobiDisplayCaption.Focused, "Focused"])
    cbDisplayCaption = self.builder.get_object("cbDisplayCaption")
    cbDisplayCaption.set_model(self.lsDisplayCaption)
    cell = Gtk.CellRendererText()
    cbDisplayCaption.pack_start(cell, True)
    cbDisplayCaption.add_attribute(cell, "text", 1)
    cbDisplayCaption.set_active(self.__settings.values["display-caption-for"])
    
    self.lsDisplayNumber = Gtk.ListStore(GObject.TYPE_INT, GObject.TYPE_STRING)
    self.lsDisplayNumber.append([CobiDisplayNumber.No, "None"])
    self.lsDisplayNumber.append([CobiDisplayNumber.All, "All"])
    self.lsDisplayNumber.append([CobiDisplayNumber.Smart, "Smart"])
    cbDisplayNumber = self.builder.get_object("cbDisplayNumber")
    cbDisplayNumber.set_model(self.lsDisplayNumber)
    cell = Gtk.CellRendererText()
    cbDisplayNumber.pack_start(cell, True)
    cbDisplayNumber.add_attribute(cell, "text", 1)
    cbDisplayNumber.set_active(self.__settings.values["display-number"])
    
    self.lsGroupWindows = Gtk.ListStore(GObject.TYPE_INT, GObject.TYPE_STRING)
    self.lsGroupWindows.append([CobiGroupWindows.No, "None"])
    self.lsGroupWindows.append([CobiGroupWindows.All, "All"])
    self.lsGroupWindows.append([CobiGroupWindows.Smart, "Smart"])
    cbGroupWindows = self.builder.get_object("cbGroupWindows")
    cbGroupWindows.set_model(self.lsGroupWindows)
    cell = Gtk.CellRendererText()
    cbGroupWindows.pack_start(cell, True)
    cbGroupWindows.add_attribute(cell, "text", 1)
    cbGroupWindows.set_active(self.__settings.values["group-windows"])
    
    cbDisplayPinnedApps = self.builder.get_object("cbDisplayPinnedApps")
    cbDisplayPinnedApps.set_active(self.__settings.values["display-pinned"])
    
    cbHoverPreview = self.builder.get_object("cbHoverPreview")
    cbHoverPreview.set_active(self.__settings.values["hover-preview"])
    
    sbTimeoutShow = self.builder.get_object("sbTimeoutShow")
    sbTimeoutShow.set_range(0, 5000)
    sbTimeoutShow.set_increments(1, 1)
    sbTimeoutShow.set_value(self.__settings.values["preview-timeout-show"])
    
    sbTimeoutHide = self.builder.get_object("sbTimeoutHide")
    sbTimeoutHide.set_range(0, 5000)
    sbTimeoutHide.set_increments(1, 1)
    sbTimeoutHide.set_value(self.__settings.values["preview-timeout-hide"])
    
    sbAnimationTime = self.builder.get_object("sbAnimationTime")
    sbAnimationTime.set_range(0, 5000)
    sbAnimationTime.set_increments(1, 1)
    sbAnimationTime.set_value(self.__settings.values["animation-time"])
    
    self.updateApplyButtonSensitivity()

    window = self.builder.get_object("SettingsWindow")
    window.show_all()
    
  def destroy(self, window):
    Gtk.main_quit()
    
  def okPressed(self, button):
    self.applySettings(button)
    Gtk.main_quit()
  
  def applySettings(self, button):
    self.__settings.writeSettings()
    self.updateApplyButtonSensitivity()
  
  def cancel(self, button):
    Gtk.main_quit()
  
  def onCaptionTypeChanged(self, button):
    self.__settings.setEntry("caption-type", button.get_active(), False)
    self.updateApplyButtonSensitivity()
  
  def onDisplayCaptionChanged(self, button):
    self.__settings.setEntry("display-caption-for", button.get_active(), False)
    self.updateApplyButtonSensitivity()
  
  def onDisplayNumberChanged(self, button):
    self.__settings.setEntry("display-number", button.get_active(), False)
    self.updateApplyButtonSensitivity()
  
  def onGroupWindowsChanged(self, button):
    self.__settings.setEntry("group-windows", button.get_active(), False)
    self.updateApplyButtonSensitivity()
  
  def onDisplayPinnedAppsChanged(self, button):
    self.__settings.setEntry("display-pinned", button.get_active(), False)
    self.updateApplyButtonSensitivity()
  
  def onHoverPreviewChanged(self, button):
    self.__settings.setEntry("hover-preview", button.get_active(), False)
    self.updateApplyButtonSensitivity()
  
  def onTimeoutShowChanged(self, button):
    self.__settings.setEntry("preview-timeout-show", int(button.get_value()), False)
    self.updateApplyButtonSensitivity()
  
  def onTimeoutHideChanged(self, button):
    self.__settings.setEntry("preview-timeout-hide", int(button.get_value()), False)
    self.updateApplyButtonSensitivity()
  
  def onAnimationTimeChanged(self, button):
    self.__settings.setEntry("animation-time", int(button.get_value()), False)
    self.updateApplyButtonSensitivity()
  
  def updateApplyButtonSensitivity(self):
    btn = self.builder.get_object("buttonApply")
    changed = self.__settings.changed()
    btn.set_sensitive(changed)

def main():
  app = CobiWindowListSettings()
  Gtk.main()
    
if __name__ == "__main__":
  if len(sys.argv) != 2:
    print("Usage: settings.py <applet_id>")
    exit(0);
  main()
