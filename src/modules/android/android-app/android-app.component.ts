import './android-app.component.scss';
import angular from 'angular';
import { Component, OnInit } from 'angular-ts-decorators';
import autobind from 'autobind-decorator';
import compareVersions from 'compare-versions';
import Strings from '../../../../res/strings/en.json';
import AppMainComponent from '../../app/app-main/app-main.component';
import { AppEventType, AppViewType } from '../../app/app.enum';
import { AppHelperService } from '../../app/app.interface';
import AlertService from '../../shared/alert/alert.service';
import BookmarkHelperService from '../../shared/bookmark/bookmark-helper/bookmark-helper.service';
import { BookmarkMetadata } from '../../shared/bookmark/bookmark.interface';
import * as Exceptions from '../../shared/exception/exception';
import Globals from '../../shared/global-shared.constants';
import { PlatformService } from '../../shared/global-shared.interface';
import LogService from '../../shared/log/log.service';
import NetworkService from '../../shared/network/network.service';
import SettingsService from '../../shared/settings/settings.service';
import { StoreKey } from '../../shared/store/store.enum';
import StoreService from '../../shared/store/store.service';
import SyncEngineService from '../../shared/sync/sync-engine/sync-engine.service';
import UtilityService from '../../shared/utility/utility.service';
import WorkingService from '../../shared/working/working.service';
import AndroidPlatformService from '../android-platform.service';
import AndroidAppHelperService from './android-app-helper/android-app-helper.service';
import { AndroidAlert } from './android-app.interface';

@autobind
@Component({
  controllerAs: 'vm',
  selector: 'app',
  template: require('../../app/app-main/app-main.component.html')
})
export default class AndroidAppComponent extends AppMainComponent implements OnInit {
  $interval: ng.IIntervalService;
  appHelperSvc: AndroidAppHelperService;
  platformSvc: AndroidPlatformService;
  syncEngineSvc: SyncEngineService;

  sharedBookmark: BookmarkMetadata;

  static $inject = [
    '$interval',
    '$q',
    '$scope',
    '$timeout',
    'AlertService',
    'AppHelperService',
    'BookmarkHelperService',
    'LogService',
    'NetworkService',
    'PlatformService',
    'SettingsService',
    'StoreService',
    'SyncEngineService',
    'UtilityService',
    'WorkingService'
  ];
  constructor(
    $interval: ng.IIntervalService,
    $q: ng.IQService,
    $scope: ng.IScope,
    $timeout: ng.ITimeoutService,
    AlertSvc: AlertService,
    AppHelperSvc: AppHelperService,
    BookmarkHelperSvc: BookmarkHelperService,
    LogSvc: LogService,
    NetworkSvc: NetworkService,
    PlatformSvc: PlatformService,
    SettingsSvc: SettingsService,
    StoreSvc: StoreService,
    SyncEngineSvc: SyncEngineService,
    UtilitySvc: UtilityService,
    WorkingSvc: WorkingService
  ) {
    super(
      $q,
      $scope,
      $timeout,
      AlertSvc,
      AppHelperSvc,
      BookmarkHelperSvc,
      LogSvc,
      NetworkSvc,
      PlatformSvc,
      SettingsSvc,
      StoreSvc,
      UtilitySvc,
      WorkingSvc
    );

    this.$interval = $interval;
    this.syncEngineSvc = SyncEngineSvc;
  }

  checkForDarkTheme(): ng.IPromise<void> {
    // Check dark theme is supported
    return this.$q<void>((resolve, reject) => {
      window.cordova.plugins.ThemeDetection.isAvailable(resolve, reject);
    }).then((isAvailable: any) => {
      if (!isAvailable.value) {
        return;
      }

      // Check dark theme is enabled
      return this.$q<void>((resolve, reject) => {
        window.cordova.plugins.ThemeDetection.isDarkModeEnabled(resolve, reject);
      })
        .then((isDarkModeEnabled: any) => this.settingsSvc.darkModeEnabled(isDarkModeEnabled.value))
        .then(() => {});
    });
  }

  checkForInstallOrUpgrade(): ng.IPromise<void> {
    // Check for stored app version and compare it to current
    const mobileAppVersion = localStorage.getItem('xBrowserSync-mobileAppVersion');
    return this.platformSvc.getAppVersion().then((appVersion) => {
      return (mobileAppVersion
        ? this.$q.resolve(mobileAppVersion)
        : this.storeSvc.get<string>(StoreKey.AppVersion)
      ).then((currentVersion) => {
        return currentVersion ? this.handleUpgrade(currentVersion, appVersion) : this.handleInstall(appVersion);
      });
    });
  }

  checkForNewVersion(): void {
    this.$timeout(() => {
      this.platformSvc.getAppVersion().then((appVersion) => {
        this.utilitySvc.checkForNewVersion(appVersion).then((newVersion) => {
          if (!newVersion) {
            return;
          }

          this.alertSvc.setCurrentAlert({
            message: this.platformSvc
              .getI18nString(Strings.appUpdateAvailable_Android_Message)
              .replace('{version}', newVersion),
            action: this.platformSvc.getI18nString(Strings.button_View_Label),
            actionCallback: () => {
              this.platformSvc.openUrl(Globals.ReleaseNotesUrlStem + (newVersion as string).replace(/^v/, ''));
            }
          } as AndroidAlert);
        });
      });
    }, 1e3);
  }

  checkForSharedBookmark(): ng.IPromise<void> {
    const bookmark = this.getSharedBookmark();
    if (!bookmark) {
      return this.$q.resolve();
    }

    // Set current page as shared bookmark and display bookmark panel
    this.platformSvc.currentPage = bookmark;
    return this.appHelperSvc.switchView({ data: { bookmark }, view: AppViewType.Bookmark }).finally(() => {
      // Clear current page
      this.platformSvc.currentPage = undefined;
    });
  }

  executeSyncIfOnline(displayLoadingId): ng.IPromise<boolean> {
    // If not online display an alert and return
    if (!this.networkSvc.isNetworkConnected()) {
      this.alertSvc.setCurrentAlert({
        message: this.platformSvc.getI18nString(Strings.workingOffline_Message),
        title: this.platformSvc.getI18nString(Strings.workingOffline_Title)
      });
      return this.$q.resolve(false);
    }

    // Sync bookmarks
    return this.platformSvc.executeSync(false, displayLoadingId).then(() => {
      return true;
    });
  }

  getAllFromNativeStorage(): ng.IPromise<any> {
    return this.$q<any>((resolve, reject) => {
      const nativeStorageItems: any = {};

      const failure = (err = new Error()) => {
        if ((err as any).code === 2) {
          // Item not found
          return resolve(null);
        }
        reject(new Exceptions.FailedLocalStorageException(undefined, err));
      };

      const success = (keys: string[]) => {
        this.$q
          .all(
            keys.map((key) => {
              return this.$q((resolveGetItem, rejectGetItem) => {
                window.NativeStorage.getItem(
                  key,
                  (result: any) => {
                    nativeStorageItems[key] = result;
                    resolveGetItem();
                  },
                  rejectGetItem
                );
              });
            })
          )
          .then(() => {
            resolve(nativeStorageItems);
          })
          .catch(failure);
      };

      window.NativeStorage.keys(success, failure);
    });
  }

  getSharedBookmark(): BookmarkMetadata {
    if (!this.sharedBookmark) {
      return;
    }

    const bookmark = this.sharedBookmark;
    const txt = document.createElement('textarea');
    txt.innerHTML = bookmark.title ? bookmark.title.trim() : '';
    bookmark.title = txt.value;
    this.sharedBookmark = null;
    return bookmark;
  }

  handleBackButton(event: Event): void {
    const currentView = this.appHelperSvc.getCurrentView();
    if (
      currentView.view === AppViewType.Bookmark ||
      currentView.view === AppViewType.Help ||
      currentView.view === AppViewType.Scan ||
      currentView.view === AppViewType.Settings ||
      currentView.view === AppViewType.Support ||
      currentView.view === AppViewType.Updated
    ) {
      // Back to login/search panel
      event.preventDefault();
      this.appHelperSvc.switchView();
    } else {
      // On main view, exit app
      event.preventDefault();
      window.cordova.plugins.exit();
    }
  }

  handleDeviceReady(success: () => any, failure: () => any): ng.IPromise<any> {
    // Configure events
    document.addEventListener('backbutton', this.handleBackButton, false);
    document.addEventListener('touchstart', this.handleTouchStart, false);
    window.addEventListener('keyboardDidShow', this.handleKeyboardDidShow);
    window.addEventListener('keyboardWillHide', this.handleKeyboardWillHide);

    // Check if an intent started the app and detect future shared intents
    window.plugins.intentShim.getIntent(this.handleNewIntent, () => {});
    window.plugins.intentShim.onIntent(this.handleNewIntent);

    // Enable app working in background to check for uncommitted syncs
    window.cordova.plugins.backgroundMode.setDefaults({ hidden: true, silent: true });
    window.cordova.plugins.backgroundMode.on('activate', () => {
      window.cordova.plugins.backgroundMode.disableWebViewOptimizations();
    });

    // Check for upgrade or do fresh install
    return (
      this.checkForInstallOrUpgrade()
        // Run startup process after install/upgrade
        .then(this.handleStartup)
        .then(success)
        .catch(failure)
    );
  }

  handleInstall(installedVersion: string): ng.IPromise<void> {
    return this.storeSvc
      .init()
      .then(() => this.storeSvc.set(StoreKey.AppVersion, installedVersion))
      .then(() => {
        this.logSvc.logInfo(`Installed v${installedVersion}`);
      });
  }

  handleKeyboardDidShow(event: any): void {
    document.body.style.height = `calc(100% - ${event.keyboardHeight}px)`;
    setTimeout(() => {
      (document.activeElement as any).scrollIntoViewIfNeeded();
    }, 100);
  }

  handleKeyboardWillHide(): void {
    document.body.style.removeProperty('height');
  }

  handleNewIntent(intent: any): void {
    if (!intent || !intent.extras) {
      return;
    }

    this.logSvc.logInfo(`Detected new intent: ${intent.extras['android.intent.extra.TEXT']}`);

    // Set shared bookmark with shared intent data
    this.sharedBookmark = {
      title: intent.extras['android.intent.extra.SUBJECT'],
      url: intent.extras['android.intent.extra.TEXT']
    };
  }

  handleResume(): ng.IPromise<void> {
    // Set theme
    return this.checkForDarkTheme().then(() => {
      // Check if sync enabled and reset network disconnected flag
      this.utilitySvc.isSyncEnabled().then((syncEnabled) => {
        if (this.appHelperSvc.getCurrentView().view === AppViewType.Search) {
          // Deselect bookmark
          this.utilitySvc.broadcastEvent(AppEventType.ClearSelectedBookmark);
        }

        if (!syncEnabled) {
          return;
        }

        // If not online display an alert and return
        if (!this.networkSvc.isNetworkConnected()) {
          this.alertSvc.setCurrentAlert({
            message: this.platformSvc.getI18nString(Strings.workingOffline_Message),
            title: this.platformSvc.getI18nString(Strings.workingOffline_Title)
          });
          return;
        }

        // Check for uncommitted syncs or sync updates
        this.appHelperSvc
          .getSyncQueueLength()
          .then((syncQueueLength) => {
            return syncQueueLength === 0 ? this.syncEngineSvc.checkForUpdates() : true;
          })
          .then((runSync) => {
            if (!runSync) {
              return;
            }

            // Run sync
            return this.executeSyncIfOnline('delayDisplayDialog').then(() => {
              // Refresh search results if query not present
              if (this.appHelperSvc.getCurrentView().view === AppViewType.Search) {
                this.utilitySvc.broadcastEvent(AppEventType.RefreshBookmarkSearchResults);
              }
            });
          })
          .then(() => {
            // Check if a bookmark was shared
            return this.checkForSharedBookmark();
          });
      });
    });
  }

  handleStartup(): ng.IPromise<void> {
    this.logSvc.logInfo('Starting up');

    // Set theme
    return this.checkForDarkTheme().then(() => {
      return this.$q
        .all([
          this.settingsSvc.checkForAppUpdates(),
          this.storeSvc.get([
            StoreKey.AppVersion,
            StoreKey.LastUpdated,
            StoreKey.ServiceUrl,
            StoreKey.SyncId,
            StoreKey.SyncVersion
          ]),
          this.utilitySvc.isSyncEnabled()
        ])
        .then((result) => {
          const checkForAppUpdates = result[0];
          const storeContent = result[1];
          const syncEnabled = result[2];

          // Prime bookmarks cache
          if (syncEnabled) {
            this.bookmarkHelperSvc.getCachedBookmarks();
          }

          // Add useful debug info to beginning of trace log
          const debugInfo = angular.copy(storeContent) as any;
          debugInfo.checkForAppUpdates = checkForAppUpdates;
          debugInfo.platform = {
            name: window.device.platform,
            device: `${window.device.manufacturer} ${window.device.model}`
          };
          debugInfo.syncEnabled = syncEnabled;
          this.logSvc.logInfo(
            Object.keys(debugInfo)
              .filter((key) => {
                return debugInfo[key] != null;
              })
              .reduce((prev, current) => {
                prev[current] = debugInfo[current];
                return prev;
              }, {})
          );

          // Check for new app version
          if (checkForAppUpdates) {
            this.checkForNewVersion();
          }

          // Exit if sync not enabled
          if (!syncEnabled) {
            return;
          }

          // If not online display an alert and return
          if (!this.networkSvc.isNetworkConnected()) {
            this.alertSvc.setCurrentAlert({
              message: this.platformSvc.getI18nString(Strings.workingOffline_Message),
              title: this.platformSvc.getI18nString(Strings.workingOffline_Title)
            });
            return;
          }

          // Check for uncommitted syncs or sync updates
          this.appHelperSvc
            .getSyncQueueLength()
            .then((syncQueueLength) => {
              return syncQueueLength === 0 ? this.syncEngineSvc.checkForUpdates() : true;
            })
            .then((runSync) => {
              if (!runSync) {
                return;
              }

              // Run sync
              this.executeSyncIfOnline('delayDisplayDialog').then((isOnline) => {
                if (isOnline === false) {
                  return;
                }

                // Refresh search results if query not present
                if (this.appHelperSvc.getCurrentView().view === AppViewType.Search) {
                  // Refresh search results if query not present
                  if (this.appHelperSvc.getCurrentView().view === AppViewType.Search) {
                    this.utilitySvc.broadcastEvent(AppEventType.RefreshBookmarkSearchResults);
                  }
                }
              });
            })
            .then(() => {
              // Check if a bookmark was shared
              return this.checkForSharedBookmark();
            });
        });
    });
  }

  handleTouchStart(event: Event): void {
    // Blur focus (and hide keyboard) when pressing out of text fields
    if (!this.utilitySvc.isTextInput(event.target as Element) && this.utilitySvc.isTextInput(document.activeElement)) {
      this.$timeout(() => {
        (document.activeElement as HTMLInputElement).blur();
      }, 100);
    }
  }

  handleUpgrade(oldVersion: string, newVersion: string): ng.IPromise<void> {
    if (compareVersions.compare(oldVersion, newVersion, '=')) {
      // No upgrade
      return this.$q.resolve();
    }

    // Clear trace log
    return this.storeSvc
      .remove(StoreKey.TraceLog)
      .then(() => {
        this.logSvc.logInfo(`Upgrading from ${oldVersion} to ${newVersion}`);
      })
      .then(() => {
        if (compareVersions(oldVersion, newVersion)) {
          switch (true) {
            case newVersion.indexOf('1.6.0') === 0:
              return this.upgradeTo160();
            default:
          }
        }
      })
      .then(() => {
        return this.$q
          .all([this.storeSvc.set(StoreKey.AppVersion, newVersion), this.storeSvc.set(StoreKey.DisplayUpdated, true)])
          .then(() => {});
      });
  }

  ngOnInit(): ng.IPromise<void> {
    // Load i18n strings
    return this.platformSvc
      .initI18n()
      .then(() => {
        // Bind to cordova device events
        return this.$q<void>((resolve, reject) => {
          document.addEventListener(
            'deviceready',
            () => {
              this.handleDeviceReady(resolve, reject);
            },
            false
          );
          document.addEventListener('resume', this.handleResume, false);
        });
      })
      .then(() => super.ngOnInit());
  }

  upgradeTo160(): ng.IPromise<void> {
    // Convert local storage items to IndexedDB
    return this.getAllFromNativeStorage()
      .then((cachedData) => {
        if (!cachedData || Object.keys(cachedData).length === 0) {
          return;
        }

        return this.$q.all(
          Object.keys(cachedData).map((key) => {
            return this.storeSvc.set(key, cachedData[key]);
          })
        );
      })
      .then(() => {
        return window.NativeStorage.clear();
      });
  }

  workingCancelAction(): ng.IPromise<void> {
    this.utilitySvc.broadcastEvent(AppEventType.WorkingCancelAction);
    return this.$q.resolve();
  }
}
