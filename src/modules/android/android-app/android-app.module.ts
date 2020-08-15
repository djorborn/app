import 'angular-hammer';
import angular from 'angular';
import { NgModule } from 'angular-ts-decorators';
import AppModule from '../../app/app.module';
import AndroidBookmarkService from '../android-bookmark/android-bookmark.service';
import AndroidPlatformService from '../android-platform.service';
import AndroidStoreService from '../android-store/android-store.service';
import AndroidAppAlertComponent from './android-app-alert/android-app-alert.component';
import AndroidAppBookmarkComponent from './android-app-bookmark/android-app-bookmark.component';
import AndroidAppHelperService from './android-app-helper/android-app-helper.service';
import AndroidAppScanComponent from './android-app-scan/android-app-scan.component';
import AndroidAppSearchComponent from './android-app-search/android-app-search.component';
import AndroidAppWorkingComponent from './android-app-working/android-app-working.component';
import AndroidAppComponent from './android-app.component';

@NgModule({
  declarations: [
    AndroidAppAlertComponent,
    AndroidAppBookmarkComponent,
    AndroidAppComponent,
    AndroidAppScanComponent,
    AndroidAppSearchComponent,
    AndroidAppWorkingComponent
  ],
  id: 'AndroidAppModule',
  imports: [AppModule, 'hmTouchEvents'],
  providers: [AndroidAppHelperService, AndroidBookmarkService, AndroidPlatformService, AndroidStoreService]
})
export default class AndroidAppModule {}

angular.element(document).ready(() => {
  angular.bootstrap(document, [(AndroidAppModule as NgModule).module.name], { strictDi: true });
});
