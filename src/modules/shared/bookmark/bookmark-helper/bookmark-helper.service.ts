import angular from 'angular';
import { Injectable } from 'angular-ts-decorators';
import autobind from 'autobind-decorator';
import { Bookmarks as NativeBookmarks } from 'webextension-polyfill-ts';
import { BookmarkSearchResult } from '../../../app/app-search/app-search.interface';
import { ApiService } from '../../api/api.interface';
import CryptoService from '../../crypto/crypto.service';
import * as Exceptions from '../../exception/exception';
import Globals from '../../global-shared.constants';
import { PlatformService } from '../../global-shared.interface';
import { StoreKey } from '../../store/store.enum';
import StoreService from '../../store/store.service';
import UtilityService from '../../utility/utility.service';
import { BookmarkContainer } from '../bookmark.enum';
import { Bookmark, BookmarkMetadata } from '../bookmark.interface';

@autobind
@Injectable('BookmarkHelperService')
export default class BookmarkHelperService {
  Strings = require('../../../../../res/strings/en.json');

  $injector: ng.auto.IInjectorService;
  $q: ng.IQService;
  apiSvc: ApiService;
  cryptoSvc: CryptoService;
  _platformSvc: PlatformService;
  storeSvc: StoreService;
  utilitySvc: UtilityService;

  cachedBookmarks_encrypted: string;
  cachedBookmarks_plain: Bookmark[];

  static $inject = ['$injector', '$q', 'ApiService', 'CryptoService', 'StoreService', 'UtilityService'];
  constructor(
    $injector: ng.auto.IInjectorService,
    $q: ng.IQService,
    ApiSvc: ApiService,
    CryptoSvc: CryptoService,
    StoreSvc: StoreService,
    UtilitySvc: UtilityService
  ) {
    this.$injector = $injector;
    this.$q = $q;
    this.apiSvc = ApiSvc;
    this.cryptoSvc = CryptoSvc;
    this.storeSvc = StoreSvc;
    this.utilitySvc = UtilitySvc;
  }

  get platformSvc(): PlatformService {
    if (angular.isUndefined(this._platformSvc)) {
      this._platformSvc = this.$injector.get('PlatformService');
    }
    return this._platformSvc;
  }

  bookmarkIsContainer(bookmark: Bookmark | NativeBookmarks.BookmarkTreeNode): boolean {
    return (
      bookmark.title === BookmarkContainer.Menu ||
      bookmark.title === BookmarkContainer.Mobile ||
      bookmark.title === BookmarkContainer.Other ||
      bookmark.title === BookmarkContainer.Toolbar
    );
  }

  cleanBookmark(bookmark: Bookmark): Bookmark {
    // Remove empty properties, except for children array
    const cleanedBookmark: Bookmark = {};
    Object.keys(bookmark).forEach((key) => {
      if (
        (angular.isString(bookmark[key]) || (angular.isArray(bookmark[key]) && key !== 'children')) &&
        bookmark[key].length === 0
      ) {
        return;
      }
      if (bookmark[key] == null) {
        return;
      }
      cleanedBookmark[key] = bookmark[key];
    });

    return cleanedBookmark;
  }

  eachBookmark<T = Bookmark>(bookmarks: T[], iteratee: (rootBookmark: T) => void, untilCondition = false): void {
    // Run the iteratee function for every bookmark until the condition is met
    const iterateBookmarks = (bookmarksToIterate: T[]): void => {
      for (let i = 0; i < bookmarksToIterate.length; i += 1) {
        if (untilCondition) {
          return;
        }
        iteratee(bookmarksToIterate[i]);
        if ((bookmarksToIterate[i] as any).children?.length > 0) {
          iterateBookmarks((bookmarksToIterate[i] as any).children);
        }
      }
    };
    iterateBookmarks(bookmarks);
  }

  findBookmarkById(
    id: number | string,
    bookmarks: Bookmark[] | NativeBookmarks.BookmarkTreeNode[]
  ): Bookmark | NativeBookmarks.BookmarkTreeNode {
    if (angular.isUndefined(bookmarks) || angular.isUndefined(id)) {
      return;
    }

    // Recursively iterate through all bookmarks until id match is found
    let bookmark: Bookmark | NativeBookmarks.BookmarkTreeNode;
    const index = bookmarks.findIndex((x) => {
      return x.id === id;
    });
    if (index === -1) {
      (bookmarks as Bookmark[]).forEach((x) => {
        if (!bookmark) {
          bookmark = this.findBookmarkById(id, x.children);
        }
      });
    } else {
      bookmark = bookmarks[index];
      // Set index as bookmark indexes in Firefox are unreliable!
      // https://bugzilla.mozilla.org/show_bug.cgi?id=1556427
      if ((bookmark as NativeBookmarks.BookmarkTreeNode).index != null) {
        (bookmark as NativeBookmarks.BookmarkTreeNode).index = index;
      }
    }

    return bookmark;
  }

  findCurrentUrlInBookmarks(): ng.IPromise<Bookmark> {
    // Check if current url is contained in bookmarks
    return this.platformSvc.getCurrentUrl().then((currentUrl) => {
      if (!currentUrl) {
        return;
      }

      return this.searchBookmarks({ url: currentUrl }).then((searchResults) => {
        const searchResult = searchResults.find((bookmark) => {
          return bookmark.url.toLowerCase() === currentUrl.toLowerCase();
        });

        return this.$q.resolve(searchResult);
      });
    });
  }

  extractBookmarkMetadata(bookmark: Bookmark | NativeBookmarks.BookmarkTreeNode): BookmarkMetadata {
    const metadata: BookmarkMetadata = {
      description: (bookmark as Bookmark).description,
      isSeparator: this.isSeparator(bookmark),
      tags: (bookmark as Bookmark).tags,
      title: bookmark.title,
      url: bookmark.url
    };

    Object.keys(metadata).forEach((key) => {
      if (angular.isUndefined(metadata[key] ?? undefined)) {
        delete metadata[key];
      }
    });

    return metadata;
  }

  getCachedBookmarks(): ng.IPromise<Bookmark[]> {
    // Get cached encrypted bookmarks from store
    return this.storeSvc.get<string>(StoreKey.Bookmarks).then((encryptedBookmarksFromStore) => {
      // Return unencrypted cached bookmarks from memory if encrypted bookmarks
      // in storage match cached encrypted bookmarks in memory
      let getBookmarksPromise: ng.IPromise<Bookmark[]>;
      if (
        encryptedBookmarksFromStore &&
        this.cachedBookmarks_encrypted &&
        encryptedBookmarksFromStore === this.cachedBookmarks_encrypted
      ) {
        getBookmarksPromise = this.$q.resolve(this.cachedBookmarks_plain);
      }

      // If encrypted bookmarks not cached in storage, get synced bookmarks
      getBookmarksPromise = (encryptedBookmarksFromStore
        ? this.$q.resolve(encryptedBookmarksFromStore)
        : this.apiSvc.getBookmarks().then((response) => {
            return response.bookmarks;
          })
      ).then((encryptedBookmarks) => {
        // Decrypt bookmarks
        return this.cryptoSvc.decryptData(encryptedBookmarks).then((decryptedBookmarks) => {
          // Update cache with retrieved bookmarks data
          const bookmarks: Bookmark[] = decryptedBookmarks ? JSON.parse(decryptedBookmarks) : [];
          return this.updateCachedBookmarks(bookmarks, encryptedBookmarks).then(() => {
            return bookmarks;
          });
        });
      });

      return getBookmarksPromise.then((cachedBookmarks) => {
        return angular.copy(cachedBookmarks);
      });
    });
  }

  getContainer(containerName: string, bookmarks: Bookmark[], createIfNotPresent = false): Bookmark {
    // If container does not exist, create it if specified
    let container = bookmarks.find((x) => x.title === containerName);
    if (!container && createIfNotPresent) {
      container = this.newBookmark(containerName, null, null, null, false, bookmarks);
      bookmarks.push(container);
    }
    return container;
  }

  getContainerByBookmarkId(id: number, bookmarks: Bookmark[]): Bookmark {
    // Check if the id corresponds to a container
    const bookmark = this.findBookmarkById(id, bookmarks);
    if (this.bookmarkIsContainer(bookmark as Bookmark)) {
      return bookmark as Bookmark;
    }

    // Search through the child bookmarks of each container to find the bookmark
    let container: Bookmark;
    bookmarks.forEach((x) => {
      this.eachBookmark(
        x.children,
        (child) => {
          if (child.id === id) {
            container = x;
          }
        },
        container != null
      );
    });
    return container;
  }

  getKeywordsFromBookmark(bookmark: Bookmark, tagsOnly = false): string[] {
    let keywords: string[] = [];
    if (!tagsOnly) {
      // Add all words in title and description
      keywords = keywords.concat(this.utilitySvc.splitTextIntoWords(bookmark.title));
      keywords = keywords.concat(this.utilitySvc.splitTextIntoWords(bookmark.description));

      // Add url host
      const hostMatch = bookmark.url?.toLowerCase().match(/^(https?:\/\/)?(www\.)?([^/]+)/);
      if (hostMatch) {
        keywords.push(hostMatch[3]);
        if (!angular.isUndefined(hostMatch[2])) {
          keywords.push(hostMatch[2] + hostMatch[3]);
        }
      }
    }

    // Add tags
    keywords = keywords.concat(this.utilitySvc.splitTextIntoWords(bookmark.tags?.join(' ')));

    // Remove words of two chars or less
    keywords = keywords.filter((item) => {
      return item.length > 2;
    });

    // Remove duplicates, sort and return
    const sortedKeywords = this.utilitySvc.sortWords(keywords);
    return sortedKeywords;
  }

  getLookahead(word: string, bookmarks: Bookmark[], tagsOnly = false, exclusions: string[] = []): ng.IPromise<any> {
    if (!word) {
      return this.$q.resolve('');
    }

    let getBookmarks: ng.IPromise<Bookmark[]>;
    if (bookmarks?.length > 0) {
      // Use supplied bookmarks
      getBookmarks = this.$q.resolve(bookmarks);
    } else {
      // Get cached bookmarks
      getBookmarks = this.getCachedBookmarks();
    }

    // With bookmarks
    return getBookmarks
      .then((bookmarksToSearch) => {
        // Get lookaheads
        let lookaheads = this.searchBookmarksForLookaheads(bookmarksToSearch, word, tagsOnly);

        // Remove exclusions from lookaheads
        if (exclusions) {
          lookaheads = lookaheads.filter((x) => !exclusions.includes(x));
        }

        if (lookaheads.length === 0) {
          return;
        }

        // Count lookaheads and return most common
        const counts = lookaheads.reduce((acc, val) => {
          acc[val] = acc[val] === undefined ? 1 : (acc[val] += 1);
          return acc;
        }, {});
        const lookahead = Object.keys(counts).reduce((x, y) => {
          return counts[x] > counts[y] ? x : y;
        });

        return [lookahead, word];
      })
      .catch((err) => {
        // Swallow error if request was cancelled
        if (err instanceof Exceptions.HttpRequestCancelledException) {
          return;
        }

        throw err;
      });
  }

  getNativeBookmarksAsBookmarks(nativeBookmarks: NativeBookmarks.BookmarkTreeNode[]): Bookmark[] {
    const bookmarks: Bookmark[] = [];
    for (let i = 0; i < nativeBookmarks.length; i += 1) {
      // Check if current native bookmark is a separator
      const nativeBookmark = nativeBookmarks[i];
      const bookmark = this.newBookmark(nativeBookmark.title, nativeBookmark.url);

      // If this is a folder and has children, process them
      if (nativeBookmark.children?.length > 0) {
        bookmark.children = this.getNativeBookmarksAsBookmarks(nativeBookmark.children);
      }
      bookmarks.push(bookmark);
    }
    return bookmarks;
  }

  getNewBookmarkId(bookmarks: Bookmark[], takenIds: number[] = [0]): number {
    // Check existing bookmarks for highest id
    let highestId = 0;
    this.eachBookmark(bookmarks, (bookmark) => {
      if (!angular.isUndefined(bookmark.id ?? undefined) && parseInt(bookmark.id.toString(), 10) > highestId) {
        highestId = parseInt(bookmark.id.toString(), 10);
      }
    });

    // Compare highest id with supplied taken ids
    const highestTakenId = takenIds.reduce((x, y) => (x > y ? x : y));
    highestId = highestTakenId > highestId ? highestTakenId : highestId;
    return highestId + 1;
  }

  isFolder(bookmark: Bookmark | BookmarkMetadata | NativeBookmarks.BookmarkTreeNode): boolean {
    return !this.isSeparator(bookmark) && !bookmark.url;
  }

  isSeparator(bookmark: Bookmark | BookmarkMetadata | NativeBookmarks.BookmarkTreeNode): boolean {
    if (angular.isUndefined(bookmark ?? undefined)) {
      return false;
    }

    // Bookmark is separator if title is dashes or designated separator title, has no url and no children,
    // or type is separator (in FF)
    const separatorRegex = new RegExp('^[-─]{1,}$');
    return (
      (bookmark as BookmarkMetadata).isSeparator ||
      (bookmark as NativeBookmarks.BookmarkTreeNode).type === 'separator' ||
      (bookmark.title &&
        (separatorRegex.test(bookmark.title ?? '') ||
          bookmark.title.indexOf(Globals.Bookmarks.HorizontalSeparatorTitle) >= 0 ||
          bookmark.title === Globals.Bookmarks.VerticalSeparatorTitle) &&
        (!bookmark.url || bookmark.url === this.platformSvc.getNewTabUrl()) &&
        (!(bookmark as Bookmark).children || (bookmark as Bookmark).children?.length === 0))
    );
  }

  modifyBookmarkById(id: number, newMetadata: BookmarkMetadata, bookmarks: Bookmark[]): ng.IPromise<Bookmark[]> {
    const updatedBookmarks = angular.copy(bookmarks);
    const bookmarkToModify = this.findBookmarkById(id, updatedBookmarks) as Bookmark;
    if (!bookmarkToModify) {
      throw new Exceptions.BookmarkNotFoundException();
    }

    // Copy new metadata to target bookmark
    Object.assign(bookmarkToModify, newMetadata);

    // If bookmark is a separator, convert bookmark to separator
    if (this.isSeparator(bookmarkToModify)) {
      // Create a new separator with same id
      const separator = this.newBookmark(
        bookmarkToModify.title,
        bookmarkToModify.url,
        bookmarkToModify.description,
        bookmarkToModify.tags
      );
      separator.id = bookmarkToModify.id;

      // Copy separator properties
      angular.copy(separator, bookmarkToModify);
    }

    // Clean bookmark and return updated bookmarks
    angular.copy(this.cleanBookmark(bookmarkToModify), bookmarkToModify);
    return this.$q.resolve(updatedBookmarks);
  }

  newBookmark(
    title: string,
    url?: string,
    description?: string,
    tags?: string[],
    isSeparator = false,
    bookmarksToGenerateNewId?: Bookmark[]
  ): Bookmark {
    const newSeparator: Bookmark = {
      title: '-'
    };

    let newBookmark: Bookmark;
    if (isSeparator) {
      newBookmark = newSeparator;
    } else {
      newBookmark = {
        children: [],
        description: this.utilitySvc.trimToNearestWord(description, Globals.Bookmarks.DescriptionMaxLength),
        tags,
        title: title?.trim(),
        url: url?.trim()
      };

      // If bookmark has a url it is not a folder so delete children prop, otherwise delete url prop
      if (url) {
        delete newBookmark.children;
      } else {
        delete newBookmark.url;
      }

      // Check once more if bookmark is a separator
      if (this.isSeparator(newBookmark)) {
        newBookmark = newSeparator;
      }
    }

    // If bookmarks provided, generate new id
    if (bookmarksToGenerateNewId) {
      newBookmark.id = this.getNewBookmarkId(bookmarksToGenerateNewId);
    }

    // Clean new bookmark of empty attributes before returning
    return this.cleanBookmark(newBookmark);
  }

  removeBookmarkById(id: number, bookmarks: Bookmark[]): ng.IPromise<Bookmark[]> {
    // Iterate through bookmarks and remove the bookmark that matches the id param
    const updatedBookmarks = angular.copy(bookmarks);
    this.eachBookmark(updatedBookmarks, (bookmark) => {
      if (!bookmark.children) {
        return;
      }
      const indexToRemove = bookmark.children.findIndex((child) => child.id === id);
      if (indexToRemove >= 0) {
        bookmark.children.splice(indexToRemove, 1);
      }
    });
    return this.$q.resolve(updatedBookmarks);
  }

  removeEmptyContainers(bookmarks: Bookmark[]): Bookmark[] {
    const menuContainer = this.getContainer(BookmarkContainer.Menu, bookmarks);
    const mobileContainer = this.getContainer(BookmarkContainer.Mobile, bookmarks);
    const otherContainer = this.getContainer(BookmarkContainer.Other, bookmarks);
    const toolbarContainer = this.getContainer(BookmarkContainer.Toolbar, bookmarks);
    const removeArr: Bookmark[] = [];

    if (menuContainer?.children?.length === 0) {
      removeArr.push(menuContainer);
    }

    if (mobileContainer?.children?.length === 0) {
      removeArr.push(mobileContainer);
    }

    if (otherContainer?.children?.length === 0) {
      removeArr.push(otherContainer);
    }

    if (toolbarContainer?.children?.length === 0) {
      removeArr.push(toolbarContainer);
    }

    return bookmarks.filter((x) => !removeArr.includes(x));
  }

  searchBookmarks(query: any): ng.IPromise<Bookmark[]> {
    if (!query) {
      query = { keywords: [] };
    }

    // Get cached bookmarks
    return this.getCachedBookmarks().then((bookmarks) => {
      let results: BookmarkSearchResult[];

      // If url supplied, first search by url
      if (query.url) {
        results = this.searchBookmarksByUrl(bookmarks, query.url) ?? [];
      }

      // Search by keywords and sort (score desc, id desc) using results from url search if relevant
      results = this.searchBookmarksByKeywords(results ?? (bookmarks as BookmarkSearchResult[]), query.keywords);
      const sortedResults = results
        .sort((x, y) => {
          return x.id - y.id;
        })
        .sort((x, y) => {
          return x.score - y.score;
        })
        .reverse();
      return sortedResults;
    });
  }

  searchBookmarksByKeywords(
    bookmarks: Bookmark[],
    keywords: string[] = [],
    results: BookmarkSearchResult[] = []
  ): BookmarkSearchResult[] {
    bookmarks.forEach((bookmark) => {
      // Ignore separators
      if (this.isSeparator(bookmark)) {
        return;
      }

      if (this.isFolder(bookmark)) {
        // If bookmark is a folder, search children
        if (bookmark.children?.length > 0) {
          this.searchBookmarksByKeywords(bookmark.children, keywords, results);
        }
      } else {
        // Get match scores for each keyword against bookmark words
        const bookmarkWords = this.getKeywordsFromBookmark(bookmark);
        const scores = keywords.map((keyword) => {
          let count = 0;
          bookmarkWords.forEach((word) => {
            if (word?.toLowerCase().indexOf(keyword.toLowerCase()) === 0) {
              count += 1;
            }
          });

          return count;
        });

        // Check all keywords match
        if (angular.isUndefined(scores.find((x) => x === 0))) {
          // Calculate score
          const score = scores.reduce((memo, num) => memo + num, 0);

          // Add result
          const result: BookmarkSearchResult = angular.copy(bookmark);
          result.score = score;
          results.push(result);
        }
      }
    });

    return results;
  }

  searchBookmarksByUrl(
    bookmarks: Bookmark[],
    url: string,
    results: BookmarkSearchResult[] = []
  ): BookmarkSearchResult[] {
    results = results.concat(
      bookmarks.filter((bookmark) => {
        // Ignore folders and separators
        if (this.isFolder(bookmark) || this.isSeparator(bookmark)) {
          return false;
        }

        // Check if the bookmark url contains the url param
        return bookmark.url.toLowerCase().indexOf(url.toLowerCase()) >= 0;
      })
    );

    for (let i = 0; i < bookmarks.length; i += 1) {
      if (bookmarks[i].children?.length > 0) {
        results = this.searchBookmarksByUrl(bookmarks[i].children, url, results);
      }
    }

    return results;
  }

  searchBookmarksForLookaheads(
    bookmarks: Bookmark[],
    word: string,
    tagsOnly = false,
    results: string[] = []
  ): string[] {
    bookmarks.forEach((bookmark) => {
      // Ignore separators
      if (this.isSeparator(bookmark)) {
        return;
      }

      if (this.isFolder(bookmark)) {
        // If bookmark is a folder, search children
        results = this.searchBookmarksForLookaheads(bookmark.children, word, tagsOnly, results);
      } else {
        // Find all words that begin with lookahead word
        const bookmarkWords = this.getKeywordsFromBookmark(bookmark, tagsOnly);
        results = results.concat(
          bookmarkWords.filter((innerbookmark) => {
            return innerbookmark.indexOf(word) === 0;
          })
        );
      }
    });

    return results;
  }

  updateCachedBookmarks(unencryptedBookmarks: Bookmark[], encryptedBookmarks: string): ng.IPromise<void> {
    return this.$q<void>((resolve) => {
      if (angular.isUndefined(encryptedBookmarks ?? undefined)) {
        return resolve();
      }

      // Update storage cache with new encrypted bookmarks
      return this.storeSvc.set(StoreKey.Bookmarks, encryptedBookmarks).then(() => {
        // Update memory cached bookmarks
        this.cachedBookmarks_encrypted = angular.copy(encryptedBookmarks);
        if (unencryptedBookmarks !== undefined) {
          this.cachedBookmarks_plain = angular.copy(unencryptedBookmarks);
        }
        resolve();
      });
    });
  }

  upgradeContainers(bookmarks: Bookmark[]): Bookmark[] {
    // Upgrade containers to use current container names
    const otherContainer = this.getContainer('_other_', bookmarks);
    if (otherContainer) {
      otherContainer.title = BookmarkContainer.Other;
    }

    const toolbarContainer = this.getContainer('_toolbar_', bookmarks);
    if (toolbarContainer) {
      toolbarContainer.title = BookmarkContainer.Toolbar;
    }

    const xbsContainerIndex = bookmarks.findIndex((x) => {
      return x.title === '_xBrowserSync_';
    });
    if (xbsContainerIndex >= 0) {
      const xbsContainer = bookmarks.splice(xbsContainerIndex, 1)[0];
      xbsContainer.title = 'Legacy xBrowserSync bookmarks';
      otherContainer.children = otherContainer.children ?? [];
      otherContainer.children.splice(0, 0, xbsContainer);
    }

    return bookmarks;
  }
}