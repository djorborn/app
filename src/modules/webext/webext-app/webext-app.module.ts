import { NgModule } from 'angular-ts-decorators';
import AppBookmarkComponent from '../../app/app-bookmark/app-bookmark.component';
import AppModule from '../../app/app.module';
import BookmarkIdMapperService from '../bookmark-id-mapper/bookmark-id-mapper.service';
import WebExtStoreService from '../webext-store/webext-store.service';
import WebExtAppAlertComponent from './webext-app-alert/webext-app-alert.component';
import WebExtAppSearchComponent from './webext-app-search/webext-app-search.component';
import WebExtAppWorkingComponent from './webext-app-working/webext-app-working.component';
import WebExtAppComponent from './webext-app.component';

@NgModule({
  declarations: [
    AppBookmarkComponent,
    WebExtAppAlertComponent,
    WebExtAppComponent,
    WebExtAppSearchComponent,
    WebExtAppWorkingComponent
  ],
  id: 'WebExtAppModule',
  imports: [AppModule],
  providers: [BookmarkIdMapperService, WebExtStoreService]
})
export default class WebExtAppModule {}
