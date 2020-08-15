import './webext-app-alert.component.scss';
import angular from 'angular';
import { Component } from 'angular-ts-decorators';
import autobind from 'autobind-decorator';
import Strings from '../../../../../res/strings/en.json';
import { AlertType } from '../../../shared/alert/alert.enum';
import { Alert } from '../../../shared/alert/alert.interface';
import AlertService from '../../../shared/alert/alert.service';
import { PlatformService } from '../../../shared/global-shared.interface';
import UtilityService from '../../../shared/utility/utility.service';

@autobind
@Component({
  controllerAs: 'vm',
  selector: 'appAlert',
  template: require('./webext-app-alert.component.html')
})
export default class WebExtAppAlertComponent {
  $scope: ng.IScope;
  $timeout: ng.ITimeoutService;
  alertSvc: AlertService;
  platformSvc: PlatformService;
  utilitySvc: UtilityService;

  alert: Alert;
  alertType = AlertType;
  showAlert = false;
  strings = Strings;

  static $inject = ['$scope', '$timeout', 'AlertService', 'PlatformService', 'UtilityService'];
  constructor(
    $scope: ng.IScope,
    $timeout: ng.ITimeoutService,
    AlertSvc: AlertService,
    PlatformSvc: PlatformService,
    UtilitySvc: UtilityService
  ) {
    this.$scope = $scope;
    this.$timeout = $timeout;
    this.alertSvc = AlertSvc;
    this.platformSvc = PlatformSvc;
    this.utilitySvc = UtilitySvc;

    $scope.$watch(
      () => AlertSvc.currentAlert,
      (newVal, oldVal) => {
        if (newVal !== oldVal) {
          this.alert = newVal;
          this.showAlert = !angular.isUndefined(newVal ?? undefined);
        }
      }
    );
  }

  close(): void {
    this.$timeout(() => {
      this.showAlert = false;
      this.alertSvc.clearCurrentAlert();
    });
  }
}
