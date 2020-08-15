import './permissions-settings.component.scss';
import { Component, OnInit } from 'angular-ts-decorators';
import autobind from 'autobind-decorator';
import Strings from '../../../../../res/strings/en.json';
import { PlatformService } from '../../../shared/global-shared.interface';
import UtilityService from '../../../shared/utility/utility.service';
import { AppHelperService } from '../../app.interface';

@autobind
@Component({
  controllerAs: 'vm',
  selector: 'permissionsSettings',
  template: require('./permissions-settings.component.html')
})
export default class PermissionsSettingsComponent implements OnInit {
  appHelperSvc: AppHelperService;
  platformSvc: PlatformService;
  utilitySvc: UtilityService;

  readWebsiteDataPermissionsGranted = false;
  strings = Strings;

  static $inject = ['AppHelperService', 'PlatformService', 'UtilityService'];
  constructor(AppHelperSvc: AppHelperService, PlatformSvc: PlatformService, UtilitySvc: UtilityService) {
    this.appHelperSvc = AppHelperSvc;
    this.platformSvc = PlatformSvc;
    this.utilitySvc = UtilitySvc;
  }

  ngOnInit(): void {
    // Initialise view model values
    this.platformSvc.checkOptionalNativePermissions().then((permissionsGranted) => {
      this.readWebsiteDataPermissionsGranted = permissionsGranted;
    });
  }

  requestPermissions(): void {
    this.appHelperSvc.requestPermissions().then((granted) => {
      this.readWebsiteDataPermissionsGranted = granted;
    });
  }

  revokePermissions(): void {
    this.appHelperSvc.removePermissions().then(() => {
      this.readWebsiteDataPermissionsGranted = false;
    });
  }
}
