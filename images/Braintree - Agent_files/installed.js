(function() {
    with( ZendeskApps.AppScope.create() ) {

  var source = (function() {
  // jQuery.Event.which key codes. These should be normalized across browsers
  var keyCode = {
    BACKSPACE: 8,
    ENTER: 13,
    COMMA: 44
  };

  return {
    events: {
      'app.activated': 'init',
      'click #send-msg': 'sendMsg',
      'click a.close': 'onMessageCloseClick',
      'keyup .message': 'onNewMessageKeyUp',
      'keypress .message': 'onNewMessageKeyPress',
      'notification.notificationMessage': 'onIncomingMessage',
      'click .new-message': 'onNewMessageClick',
      'click .cancel': 'onCancelClick',
      'click .token .delete': 'onTokenDelete',
      'click .token_list': 'onTokenListClick',
      'keypress .add_token input': 'onTokenInputKeyPress',
      'keyup .add_token input': 'onTokenInputKeyUp',
      'focusin .add_token input': 'onTokenInputFocusIn',
      'focusout .add_token input': 'onTokenInputFocusOut'
    },

    requests: {
      sendMsg: function(text, groupIds) {
        return {
          url: '/api/v2/apps/notify.json',
          type: 'POST',
          data: {
            event: 'notificationMessage',
            body: {
              text: text,
              groupIds: groupIds
            },
            app_id: this.id()
          }
        };
      },

      getAssignableGroups: function(page) {
        return {
          url: helpers.fmt('/api/v2/groups/assignable.json?page=%@', page),
          type: 'GET'
        };
      },

      getMyGroups: function() {
        return {
          url: '/api/v2/users/%@/group_memberships.json'.fmt(this.currentUser().id()),
          type: 'GET'
        };
      }
    },

    notifications: null,
    myGroupIds: null,
    groups: null,

    init: function() {
      var self = this;

      this.notifications = [];
      this.myGroupIds    = [];
      this.groups        = {};

      this.ajax('getMyGroups').done(function(data) {
        var groupMemberships = data.group_memberships;
        self.myGroupIds = _.map(groupMemberships, function(group) {
          return group.group_id;
        });
      });

      this.loadAllGroups().then(function(groupChunks) {
        groupChunks.forEach(function(groupChunk) {
          groupChunk.groups.forEach(function(group) {
            self.groups[group.name] = group.id;
          });
        });
        self.drawInbox();
      });
    },

    drawInbox: function() {
      var isAdmin = (this.currentUser().role() === "admin");
      this.switchTo('inbox', {
        isAdmin: isAdmin
      });
      this.notifications.forEach(function(notification) {
        this.addMsgToWindow(notification.message, notification.sender);
      }, this);
    },

    messageBox: function() {
      return this.$('textarea.message');
    },

    onNewMessageClick: function(event) {
      event.preventDefault();
      this.switchTo('admin');
      this.$('.groups input').autocomplete({
        source: _.keys(this.groups)
      });
      this.messageBox().focus();
    },

    onCancelClick: function(event) {
      event.preventDefault();
      this.drawInbox();
    },

    messageBoxValue: function() {
      return this.messageBox().val();
    },

    isMessageEmpty: function() {
      return !this.messageBoxValue().trim();
    },

    sendMsg: function() {
      var unknownGroups = _.difference(this.tokenValues(), _.keys(this.groups)),
          self = this,
          $groups;

      if (!_.isEmpty(unknownGroups)) {
        $groups = this.$('.token_list .token span');

        _.each(unknownGroups, function(groupName) {
          $groups.each(function(index, group) {
            var $group = self.$(group);
            if ($group.text() == groupName) {
              $group.closest('.token').addClass('unknown');
            }
          });
        });

        return;
      }
      var groupIds = _.pick(this.groups, this.tokenValues());

      this.ajax('sendMsg', this.messageBoxValue(), groupIds);
      this.drawInbox();
    },

    tokenValues: function() {
      return _.map(this.$('.token_list .token span'), function(token) {
        return token.textContent;
      });
    },

    onNewMessageKeyUp: function() {
      this.$('#send-msg').prop('disabled', this.isMessageEmpty());
    },

    onNewMessageKeyPress: function(event) {
      if (this.isMessageEmpty()) { return; }

      if ((event.ctrlKey || event.metaKey) && event.which === keyCode.ENTER) {
        this.sendMsg();
      }
    },

    REGEXP_URL: /https?:\/\/(\S+)/i,
    REGEXP_IMAGE: /\.(png|gif|bmp|jpg|jpeg|ico)$/i,
    REPLACEMENTS: [
      [/^### (.+?)$/m, "<h3>$1</h3>"],
      [/(\*\*|__)(.+?)\1/, "<strong>$2</strong>"],
      [/(\*|_)(.+?)\1/, "<em>$2</em>"],
      [/!\[(.*?)\]\((.+?)\)/, '<img src="$2" alt="$1">'],
      [/\[(.+?)\]\((\/.+?)\)/, '<a href="$2">$1</a>'],
      [/\[(.+?)\]\((https?:\/\/.+?)\)/, '<a href="$2" target="_blank">$1</a>']
    ],

    markdown: function(source) {
      var buffer = [],
          count = 0,
          match = null,
          pair, regex, replacement;

      for (var index = 0; index < this.REPLACEMENTS.length; ++index) {
        pair = this.REPLACEMENTS[index];
        regex = pair[0];
        replacement = pair[1];

        while ((match = source.match(regex))) {
          buffer.push(match[0].replace(regex, replacement));
          source = source.replace(match[0], ['@@', count, '@@'].join(''));
          ++count;
        }
      }

      while ((match = source.match(this.REGEXP_URL))) {
        if (match[0].match(this.REGEXP_IMAGE)) {
          replacement = '<img src="%@" alt="%@">'.fmt(match[0], match[0]);
        } else {
          replacement = '<a href="%@" target="_blank">%@</a>'.fmt(match[0], match[0]);
        }
        source = source.replace(match[0], ['@@', count, '@@'].join(''));
        buffer.push(replacement);
        ++count;
      }

      _.each(buffer, function(value, index) {
        source = source.replace(['@@', index, '@@'].join(''), value);
      });
      return source;
    },

    onMessageCloseClick: function(event) {
      event.preventDefault();
      var $notification = this.$(event.target).parent();
      this.notifications = _.reject(this.notifications, function(notification) {
        return notification.message.uuid === $notification.data('uuid');
      });
      $notification.remove();
    },

    onIncomingMessage: function(message, sender) {
      if (sender.email() === this.currentUser().email() || sender.role() !== 'admin') {
        return false;
      }

      var targetGroupIds = _.map(message.groupIds, function(id) { return parseInt(id, 10); });
      if (message.groupIds && !_.intersection(this.myGroupIds, targetGroupIds).length) {
        return false;
      }

      message.uuid = _.uniqueId('msg');

      // Store notification so that we can re-render it later
      this.notifications.push({
        message: message,
        sender: sender,
      });

      try { this.popover(); } catch(err) {}

      // defer ensures app is in DOM before we add a message
      _.defer(this.addMsgToWindow.bind(this), message, sender);
    },

    addMsgToWindow: function(message, sender) {
      this.$('.placeholder').hide();

      // We get sent two messages, so this makes sure we only display
      // each unique message once:
      if (this.$('li.message[data-uuid=%@]'.fmt(message.uuid)).length > 0) {
        return false;
      }

      // escape HTML
      var text = this.$('<div/>').text(message.text).html();
      text = this.markdown(text);

      var messageHTML = this.renderTemplate('message', {
        uuid: message.uuid,
        text: text,
        senderName: sender.name(),
        date: (new Date()).toLocaleString()
      });

      this.$('ul#messages').prepend(messageHTML);
    },

    onTokenInputKeyPress: function(event) {
      // Create a new token when the enter or comma keys are pressed
      if (event.which === keyCode.ENTER || event.which === keyCode.COMMA) {
        this.addTokenFromInput(event.target);
        // Prevent the character from being entered into the form input
        return false;
      }
    },

    onTokenInputKeyUp: function(event) {
      // Remove last token on backspace
      if (event.which == keyCode.BACKSPACE && event.target.value.length <= 0) {
        this.$(event.target).parents('.token_list')
                            .children('.token')
                            .last()
                            .remove();
      }
    },

    onTokenListClick: function(event) {
      var input = this.$(event.target).children('.add_token')
                                      .children('input')[0];
      if (input !== undefined) {
        input.focus();
      }
    },

    onTokenInputFocusIn: function(event) {
      var $tokenList = this.$(event.target).parents('.token_list');
      $tokenList.removeClass('ui-state-default');
      $tokenList.addClass('ui-state-focus');
    },

    onTokenInputFocusOut: function(event) {
      var $tokenList = this.$(event.target).parents('.token_list');
      $tokenList.removeClass('ui-state-focus');
      $tokenList.addClass('ui-state-default');
      this.addTokenFromInput(event.target);
    },

    addTokenFromInput: function(input) {
      if (input.value.length > 0) {
        var tokenHTML = this.renderTemplate('group-token', { groupName: input.value });
        this.$(input.parentElement).before(tokenHTML);
        input.value = '';
      }
    },

    onTokenDelete: function(e) {
      this.$(e.target).parent('li.token').remove();
    },

    loadAllGroups: function() {
      var self = this;

      return this.promise(function(done) {
        self.groupRequests().then(function(requests) {
          self.when.apply(self, requests).then(function() {
            if (requests.length === 1) {
              done([arguments[0]]);
            } else if (requests.length > 1) {
              done(_.pluck(arguments, 0));
            } else {
              done([]);
            }
          });
        });
      });
    },

    groupRequests: function() {
      var self = this;

      return this.promise(function(done) {
        var first_page = this.ajax('getAssignableGroups', 1);

        first_page.then(function(data){
          var pages = Math.ceil(data.count / 100);

          done([first_page].concat(_.range(2, pages + 1).map(function(page) {
            return self.ajax('getAssignableGroups', page);
          })));
        });
      });
    }
  };

}());
;
}
var app = ZendeskApps.defineApp(source)
  .reopenClass({"location":{"zendesk":{"top_bar":"_legacy"}},"noTemplate":false,"singleInstall":false})
  .reopen({
    appName: "Notification App",
    appVersion: "0.2.6",
    assetUrlPrefix: "/api/v2/apps/52161/assets/",
    appClassName: "app-52161",
    author: {
      name: "Zendesk",
      email: "support@zendesk.com"
    },
    translations: {"button":{"cancel":"Cancel","imageInput":"Add image link","sendMessage":"Broadcast","toAdmin":"New Message"},"label":{"groups":"Groups"},"message":{"messagePlaceholder":"Share a message with your agents. Markdown is encouraged.","placeholder":"Waiting for message..."},"app":{}},
    templates: {"admin":"\u003ctextarea class=\"message\" name=\"message\" placeholder=\"{{t 'message.messagePlaceholder'}}\"\u003e\u003c/textarea\u003e\n\n\u003cdiv class=\"groups form_field\"\u003e\n  \u003clabel\u003e{{t 'label.groups'}}\u003c/label\u003e\n  \u003cul class=\"span12 token_list highlightable\"\u003e\n    \u003cli class=\"add_token\"\u003e\u003cinput class=\"highlightable\" type=\"text\"\u003e\u003c/li\u003e\n  \u003c/ul\u003e\n\u003c/div\u003e\n\n\n\u003cdiv class=\"pull-right\"\u003e\n  \u003ca href=\"#\" class=\"cancel\"\u003e{{t 'button.cancel'}}\u003c/a\u003e\n  \u003cbutton class=\"btn-primary\" id=\"send-msg\" disabled=\"disabled\"\u003e\n    {{t 'button.sendMessage'}}\n  \u003c/button\u003e\n\u003c/div\u003e","group-token":"\u003cli class=\"token\"\u003e\u003cspan\u003e{{groupName}}\u003c/span\u003e\u003ca class=\"delete\" tabindex=\"-1\"\u003e\u0026times;\u003c/a\u003e\u003c/li\u003e","inbox":"{{#if isAdmin}}\u003ca href=\"#\" class=\"new-message pull-right\"\u003e{{t 'button.toAdmin'}}\u003c/a\u003e{{/if}}\n\u003cp class=\"placeholder\"\u003e{{t 'message.placeholder'}}\u003c/p\u003e\n\u003cul id=\"messages\"\u003e\n\u003c/ul\u003e","layout":"\u003cstyle\u003e\n.app-52161 header .logo {\n  background-image: url(\"/api/v2/apps/52161/assets/logo-small.png\"); }\n.app-52161.apps.popover {\n  height: 280px;\n  left: -435px;\n  width: 520px; }\n.app-52161 section[data-main] {\n  position: relative; }\n.app-52161 textarea.message {\n  width: 100%;\n  box-sizing: border-box;\n  height: 120px;\n  border-radius: 4px;\n  resize: none; }\n.app-52161 #send-msg {\n  margin-top: 10px;\n  border-radius: 4px;\n  padding: 5px 10px; }\n  .app-52161 #send-msg:disabled {\n    color: #ccc;\n    cursor: default; }\n.app-52161 .senderName {\n  font-weight: bold; }\n.app-52161 .messageBody {\n  margin-top: 2px; }\n.app-52161 li.message {\n  width: 100%;\n  box-sizing: border-box;\n  padding-top: 19px;\n  border-top: 1px solid #eee;\n  margin-top: 19px;\n  padding-left: 10px;\n  padding-right: 10px; }\n  .app-52161 li.message .date {\n    font-size: 11px; }\n  .app-52161 li.message .close {\n    font-size: 15px;\n    line-height: 13px; }\n  .app-52161 li.message:first-child {\n    padding-top: 0px;\n    margin-top: 0px;\n    border-top: 0px; }\n.app-52161 .cancel {\n  display: inline-block;\n  position: relative;\n  top: 6px;\n  left: -6px; }\n.app-52161 .groups {\n  width: 100%;\n  margin-top: 16px;\n  margin-bottom: 11px; }\n  .app-52161 .groups ul {\n    width: 100%;\n    box-sizing: border-box; }\n    .app-52161 .groups ul input {\n      width: 118px; }\n.app-52161 .imageInput {\n  padding-top: 19px;\n  padding-bottom: 19px;\n  border-bottom: 1px solid #eee; }\n  .app-52161 .imageInput .upload-icon {\n    display: inline-block;\n    height: 18px;\n    width: 28px;\n    background-image: url(\"/api/v2/apps/52161/assets/upload.png\"); }\n.app-52161 #messages {\n  margin: 5px;\n  box-sizing: border-box; }\n.app-52161 .new-message {\n  padding: 5px 12px;\n  border: 1px solid #dadada;\n  border-radius: 4px;\n  font-size: 12px;\n  line-height: 12px;\n  color: #333;\n  background-color: #fefefe;\n  background: linear-gradient(to bottom, #fefefe 0%, #fefefe 2%, #fbfbfb 2%, #f2f2f2 100%);\n  position: absolute;\n  top: -32px;\n  right: 10px; }\n.app-52161 .placeholder {\n  color: #ccc; }\n.app-52161 .token.unknown {\n  border: 1px solid #ebccd1;\n  background-color: #f2dede;\n  color: #a94442; }\n\u003c/style\u003e\n\u003cheader\u003e\n  \u003ch3\u003e{{setting \"name\"}}\u003c/h3\u003e\n\u003c/header\u003e\n\u003csection data-main/\u003e","message":"\u003cli class=\"message\" data-uuid=\"{{uuid}}\"\u003e\n  \u003ca href=\"#\" class=\"close\" data-dismiss=\"alert\"\u003e\u0026times;\u003c/a\u003e\n\n  \u003cp class=\"senderName\"\u003e\n    {{senderName}}\n  \u003c/p\u003e\n\n  \u003cp class='date'\u003e\n    {{date}}\n  \u003c/p\u003e\n\n  \u003cp class=\"messageBody\"\u003e\n    {{{text}}}\n  \u003c/p\u003e\n\u003c/li\u003e"},
    frameworkVersion: "1.0"
  });

ZendeskApps["Notification App"] = app;

    with( ZendeskApps.AppScope.create() ) {

  var source = (function() {

  return {
    notified: false,

    events: {
      'comment.text.changed': 'textChanged',
      'click a.dismiss'     : 'dismiss'
    },

    textChanged: _.debounce(function(){
      if (_.isEmpty(this.terms()) || this.notified)
        return;

      if (this.text().search(this.termsRegExp()) >= 0)
        return this.termFound();
    }, 500),

    termFound: function(){
      services.notify(this.I18n.t('alert.notification'), "alert");

      services.appsTray().show();

      this.disableSave();

      this.switchTo('alert');

      this.notified = true;
    },

    dismiss: function(){
      this.enableSave();

      this.switchTo('empty');
    },

    terms: _.memoize(function(){
      return _.compact((this.setting('terms') || "")
                                .split(','));
    }),

    termsRegExp: _.memoize(function(){
      return new RegExp(this.terms().join('|'));
    }),

    text: function(){
      return this.comment().text();
    }
  };

}());
;
}
var app = ZendeskApps.defineApp(source)
  .reopenClass({"location":{"support":{"ticket_sidebar":"_legacy","new_ticket_sidebar":"_legacy"}},"noTemplate":[],"singleInstall":false,"signedUrls":false})
  .reopen({
    appName: "Submission Blocker",
    appVersion: null,
    assetUrlPrefix: "https://97110.apps.zdusercontent.com/97110/assets/1474492440-bf548864d7521c9011ceda532ca56bda/",
    appClassName: "app-97110",
    author: {
      name: "Zendesk Services",
      email: "services@zendesk.com"
    },
    translations: {"app":{"description":"Warn agents when specified text is being submitted.","name":"Warning App","parameters":{"terms":{"label":"Terms","helpText":"Please provide the terms you want the App to trigger its warning on separated by commas."}}},"alert":{"notification":"About that MID...","title":"Hey.","body":"You're not updating values associated with a Wells or AIB Agg MID, are you? Please wait until this merchant receives their individual MID before making any account changes.","dismiss":"OK, Got It"}},
    templates: {"alert":"\u003cdiv class=\"alert alert-danger\"\u003e\n  \u003cp\u003e\n    \u003cstrong\u003e{{t \"alert.title\"}}\u003c/strong\u003e {{t \"alert.body\"}}\n  \u003c/p\u003e\n  \u003cbr/\u003e\n  \u003ca class=\"btn btn-inverse dismiss\"\u003e{{t \"alert.dismiss\"}}\u003c/a\u003e\n\u003c/div\u003e","empty":"","layout":"\u003cstyle\u003e\n.app-97110 header .logo {\n  background-image: url(\"https://97110.apps.zdusercontent.com/97110/assets/1474492440-bf548864d7521c9011ceda532ca56bda/logo-small.png\"); }\n.app-97110 .alert {\n  text-align: center; }\n\u003c/style\u003e\n\u003csection data-main/\u003e"},
    frameworkVersion: "1.0"
  });

ZendeskApps["Submission Blocker"] = app;

    with( ZendeskApps.AppScope.create() ) {
  require.modules = {
      "helpers.js": function(exports, require, module) {
        module.exports = {
  /* modified version with reset and variable waiting time possibilty */
  throttle: function(func, wait, options) {
    var context, args, result;
    var timeout = null;
    var previous = 0;
    if (!options) options = {};
    var later = function() {
      previous = options.leading === false ? 0 : _.now();
      timeout = null;
      result = func.apply(context, args);
      if (!timeout) context = args = null;
    };
    return function() {
      if (arguments.length === 1 && arguments[0] === 'reset') {
        if (timeout) {
          clearTimeout(timeout);
          timeout = null;
        }
        return result;
      }

      if (arguments.length === 2 && arguments[0] === 'set_wait') {
        wait = arguments[1];
        return result;
      }

      var now = _.now();
      if (!previous && options.leading === false) previous = now;
      var remaining = wait - (now - previous);
      context = this;
      args = arguments;
      if (remaining <= 0 || remaining > wait) {
        if (timeout) {
          clearTimeout(timeout);
          timeout = null;
        }
        previous = now;
        result = func.apply(context, args);
        if (!timeout) context = args = null;
      } else if (!timeout && options.trailing !== false) {
        timeout = setTimeout(later, remaining);
      }
      return result;
    };
  }
};

      },
      "telemetry.js": function(exports, require, module) {
        /* global navigator: false */
/*! version 1.1 */

/**
 * Symentic version compare
 */
function versionCompare(v1, v2) {
    if (typeof v1 !== 'string') v1 = '0';
    if (typeof v2 !== 'string') v2 = '0';

    var v1parts = v1.split('.'),
        v2parts = v2.split('.');

    function isValidPart(x) {
        return (/^\d+$/).test(x);
    }

    if (!v1parts.every(isValidPart) || !v2parts.every(isValidPart)) {
        return NaN;
    }

    while (v1parts.length < v2parts.length) v1parts.push("0");
    while (v2parts.length < v1parts.length) v2parts.push("0");

    v1parts = v1parts.map(Number);
    v2parts = v2parts.map(Number);

    for (var i = 0; i < v1parts.length; ++i) {
        if (v2parts.length === i) {
            return 1;
        }

        if (v1parts[i] === v2parts[i]) {
            continue;
        }
        else if (v1parts[i] > v2parts[i]) {
            return 1;
        }
        else {
            return -1;
        }
    }

    if (v1parts.length !== v2parts.length) {
        return -1;
    }

    return 0;
}

module.exports = {
    requests: {
        /* currently not used */
        getInstallationInfo: function() {
            return {
                url: helpers.fmt('/api/v2/apps/installations/%@.json?include=app', this.installationId()),
                type: 'GET'
            };
        },

        phoneHome: function() {
            return {
                type: 'POST',
                url: 'https://telemetry.cloudmetro.com/boxcar/telemetry.php',
                dataType: 'json',
                contentType: 'application/json',
                cors: true,
                data: JSON.stringify({
                    app_name: this.name().toLowerCase().replace(/\W/g, '-'),
                    app_version: this.version(),
                    instance_name: this.currentAccount().subdomain(),
                    instance_plan: (function(p) {
                        return p === 'enterprise' && 'e' || p === 'starter' && 's' || p === 'regular' && 'r' || p === 'plus' && 'p' || 'x';
                    })(this.currentAccount().planName().toLowerCase()),
                    user_id: this.currentUser().id(),
                    user_utc_offset: new Date().getTimezoneOffset(),
                    user_agent: navigator.userAgent
                })
            };
        }
    },

    phone: function(done) {
        if ((this.store('phoneHome') + 24*60*60*1000) > (new Date()).getTime()) {
            /* Only call done when current version is lower than server version */
            if (versionCompare(this.version(), this.store('version')) === -1 && typeof done === 'function') {
                done.call(this, {
                    updated: false,
                    update_agent_html: this.store('update_agent_html'),
                    update_admin_html: this.store('update_admin_html'),
                    app_version: this.store('version')
                });
            }
            return;
        }

        function phoneHome_done(data) {
            this.store('phoneHome', (new Date()).getTime());
            this.store('update_agent_html', data.update_agent_html);
            this.store('update_admin_html', data.update_admin_html);
            this.store('version', data.app_version);

            data.updated = true;
            if (typeof done === 'function') done.call(this, data);
        }

        this.ajax('phoneHome').done(phoneHome_done);
    }
};

      },
    eom: undefined
  };

  var source = /**
 * Quickie. A lovely views light that does nested views!
 *
 * Copyright (c) Lovestock & Leaf 2014
 *
 */
(function() {
    "use strict";

    var llHelpers = require('helpers');

    var views = { search: {}, suspended: {} }, //object to remember the states
        userGroups = [],
        _prevSearchValue,
        _gettingViewsFailed = false, /* Show error message on done, if any view getting failed */
        _showSuspended = false, /* weither or not to show suspended tickets */
        _interval1 = null, /* autorefresh */
        _countManyRetries = 0, /* retries of count_many */
        _searchMode = false; /* Set in onSearching, used in onClickExpand and onClickCollapse */

    Object.defineProperty(views, 'current', {
        get: function() {
            return this[this.currentViewId];
        },
        set: function(id) {
            if (typeof this[id] === 'undefined') throw 'Must pass a valid id of a view';
            this.currentViewId = id;
            return true;
        }
    });

    return {

        defaultState: 'loading',

        requests: _.extend({}, require('telemetry').requests, {
            getNextPage: function(page) {
                return {
                    url: page
                };
            },
            getGroups: function() {
                return {
                    url: helpers.fmt('/api/v2/users/%@/group_memberships.json', this.currentUser().id()),
                    dataType: 'json'
                };
            },
            getUser: function(id) {
                return {
                    url: helpers.fmt('/api/v2/users/%@.json?include=roles', id),
                    dataType: 'json'
                };
            },
            getViews: function() {
                this.switchTo('loading');

                return {
                    url: '/api/v2/views/active.json',
                    dataType: 'json'
                };
            },
            /* do NOT call this directly (this.ajax('getCount'), use ajax_getCount */
            getCount: function(ids) {
                return {
                    url: '/api/v2/views/count_many',
                    dataType: 'json',
                    data: {
                        ids: ids.join(',')
                    }
                };
            }
        }),

        // Here we define events such as a user clicking on something
        events: {
            // APP events
            'app.created': 'onAppCreated',
            'pane.activated': 'onPaneActivated',
            'app.willDestroy': 'onAppWillDestroy',
            'window.resize': 'onWindowResize',
            'main.scroll': 'onMainScroll',

            // TICKET events


            // Additional events
            'click ul.filters.search li.filter': 'onClickSearch',
            'click ul.filters li.filter a': 'onClickView',
            'click ul.filters a.group': 'onClickGroup',
            'click li.filter': 'onClickFilter',
            'click header .refresh': 'onClickRefresh',
            'click header .collapsing': 'onClickCollapse',
            'click header .expanding': 'onClickExpand',
            'click .popover-inner': 'focusSearch',
            'keyup input#lovely-search': 'onSearching',


            // AJAX events
            'getViews.fail': 'getViews_fail',
            'getGroups.paging_done': 'getGroups_pagingDone',
            'getCount.done': 'getCount_done',
            'getUser.paging_done': 'getUser_pagingDone'
        },

        /**
         * Initialization
         */
        onAppCreated: function(event) {

            // Check in with home
            require('telemetry').phone.call(this);

            // Check the misc folder name is set, so we can use it without problems everywhere.
            this.settings.miscFolderName = this.settings.miscFolderName || this.I18n.t('Misc');
            this.settings.personalFolderName = this.settings.personalFolderName || this.I18n.t('Personal');

        },

        /**
         * Clean up / destructor
         */
        onAppWillDestroy: function() {

            clearInterval(_interval1);

        },

        /**
         * When the pane becomes visible
         */
        onPaneActivated: function(event) {

            // if the Edit View is clicked in the dropdown menu then reload the views
            if (event.firstLoad) {

                // debounced scroll event
                this.$('[data-main]').on('scroll', _.debounce(function() {
                    this.trigger('main.scroll');
                }.bind(this), 1000));

                // auto refresh the pane
                clearInterval(_interval1);
                _interval1 = setInterval(this.periodicRefresh.bind(this), 6*60*1000); // every 6 minutes

                // hide the spinner
                this.$loader = this.$('header .lazy-loader').hide();

                // some styles
                this.$().css({backgroundColor: '#C6C6C6', border: 'none'});

                // get the account type
                var currentAccountCode = '';
                switch(this.currentAccount().planName().toLowerCase()) {
                    case 'enterprise':
                        currentAccountCode = 'e';
                        break;
                    case 'starter':
                        currentAccountCode = 's';
                        break;
                    case 'regular':
                        currentAccountCode = 'r';
                        break;
                    case 'plus':
                        currentAccountCode = 'p';
                        break;
                    default:
                        currentAccountCode = this.currentAccount().planName();
                        break;
                }

                // Update the url to point to the right site.
                this.$('footer .lovestockleaf-link').attr('href', 'http://www.lovestockleaf.com/zendesk/?a=quickie&p='.concat(encodeURIComponent(currentAccountCode), '&s=', encodeURIComponent(this.currentAccount().subdomain())));

                // show the popup
                this.popover({
                    width: 270,
                    height: 'auto'
                });

                // switch to loading template
                this.switchTo('loading');

                // auto-size the popup
                var $wrapper = this.$().parents('#wrapper');
                this.onWindowResize({height: $wrapper.height(), width: $wrapper.width()});

                // when the ajax calls are done, load the data in
                this.when(
                    this.ajax_paging('getViews'),
                    this.ajax_paging('getGroups'),
                    this.ajax('getUser', 'me')
                ).done(this.getData.bind(this));
            }

            _.defer(this.getCount.bind(this));

            _.defer(this.focusSearch.bind(this));
        },

        /**
         * Focus the search input
         */
        focusSearch: function() {
            this.$('input#lovely-search').focus();
        },

        /**
         * Adjust the max height of the pane, on window resize
         */
        onWindowResize: function(size) {
            this.$('[data-main]').css('max-height', size.height - 235);
        },

        /**
         * On scroll
         */
        onMainScroll: function(event) {
            this.getCount();
        },

        /**
         * User triggered a manual refresh of the views
         */
        onClickRefresh: function(event) {
            this.switchTo('loading');

            views.scrollTop = this.$('[data-main]').scrollTop();

            // Reset search
            _searchMode = false;
            this.$('input#lovely-search').val('');
            this.focusSearch();

            this.ajax_paging('getViews').done(this.getData.bind(this));
        },

        /**
         * Expand views group
         */
        onClickExpand: function(event) {
            this.$('ul.filters li.group').addClass('expanded');
            this.storeState();
        },

        /**
         * Collapse views group
         */
        onClickCollapse: function(event) {
            this.$('ul.filters li.group').removeClass('expanded');
            this.storeState();
        },

        onClickSearch: function(event) {
            views.current = 'search';

            this.$('li.selected').removeClass('selected');
            this.$(event.currentTarget).addClass('selected');
        },

        /**
         * Click on an different view in Quickie
         */
        onClickView: function(event) {
            // TODO: open view in views or lovely views
            this.$('li.selected').removeClass('selected');
            var id = this.$(event.currentTarget).parent().addClass('selected').attr('data-id');
            views.current = id;

            /* close the popover... */
            //this.popover('close');
        },

        /**
         * Expand/collapse the views group
         */
        onClickGroup: function(event) {
            var $elemParent = this.$(event.currentTarget).parents('li.group:first');

            $elemParent.toggleClass('expanded');

            /* sub collapse or sub expand */
            if (event.metaKey || event.ctrlKey) {
                if ($elemParent.hasClass('expanded')) {
                    $elemParent.find('li.group').addClass('expanded');
                } else {
                    $elemParent.find('li.group').removeClass('expanded');
                }
            }

            this.getCount();

            this.storeState();
        },

        /**
         * Click on any of the views
         */
        onClickFilter: function(event) {
            if (!event.altKey)
                this.popover('hide');
        },

        /**
         * As the user is typing in the search box
         */
        onSearching: _.debounce(function(event) {
            var pattern = event.currentTarget.value;
            if (pattern === _prevSearchValue)
                return;
            _prevSearchValue = pattern;

            /* Click doesn't go to the link */
            if (event.keyCode === 13) { // Enter key
                event.stopPropagation();
                this.$('ul.filters li.filter:visible:first a').click();
                this.focusSearch();
                return false;
            }

            this.$('li.no-result').hide();

            if (!pattern) {
                /* Make sure we show all the folders and filters again */
                _searchMode = false;

                /* Undo the Highlighting */
                this.$('ul.filters span.text').get().forEach(function(a) {
                    this.$(a).text(this.$(a).text());
                }, this);

                /* Show all */
                this.$('ul.filters li.group, ul.filters li.filter, ul.filters a.group').show();

                this.restoreState();
            } else {
                if (!_searchMode) {
                    this.storeState();
                    _searchMode = true;
                }
                this.onClickExpand();

                pattern = pattern.trim();

                /* If you search wrapped in / it will be handled as a reg exp */
                if (pattern[0] === '/' && pattern[pattern.length-1] === '/')
                    pattern = pattern.slice(1, pattern.length-1);
                else
                    pattern = pattern.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");

                pattern = new RegExp(pattern, "ig");

                /* Highlighting */
                this.$('ul.filters a.group span.text, ul.filters li.filter span.text').get().forEach(function(a) {
                    this.$(a).html(_.escape(this.$(a).text()).replace(pattern, function($1) {
                        return '<span class="highlight">' + $1 + '</span>';
                    }));
                }, this);

                /* Hide all the groups that don't have any filters with a highlight */
                this.$('ul.filters li.group').not(':has(.highlight)').removeClass('expanded').hide();
                /* Show all the groups that have a filter with a highlight */
                this.$('ul.filters li.group').has('.highlight').removeClass('expanded').show();

                if (this.$('ul.filters li.group a').has('.highlight').length === 1) {
                    this.$('ul.filters li.group a').has('.highlight').parent().addClass('expanded');
                }

                /* Hide all the filters that don't have a highlight */
                this.$('ul.filters li.filter').not(':has(.highlight)').hide();
                /* Show all the filters that have a highlight */
                this.$('ul.filters li.filter').has('.highlight').show();

                /* Last, show all the filters if the group itself has a highlight */
                this.$('.highlight').parent().parent().parent().find('li.filter, li.group').show();
                this.$('li.group:has(ul.filters .highlight)').addClass('expanded');

                if (this.$('ul.filters .highlight').length === 0) {
                    this.$('li.no-result').show();
                }
            }

            this.getCount();
        }, 500),

        /**
         * Save whether the view group is expanded or not
         */
        storeState: function() {
            if (_searchMode) return;
            var openIds = this.$('[data-main] ul.filters li.group.expanded').map(function(index, item) {
                return item.getAttribute('data-id');
            }).get();
            this.store('nested_views_open', openIds.join('::'));
        },

        /**
         * Expand/collapse the view group, based on previous state from store
         */
        restoreState: function() {
            // Open views if settings store in zendesk store function
            var openIds = (this.store('nested_views_open') || '').split('::');

            this.$('[data-main] ul.filters li.group').get().forEach(function(group) {
                if (openIds.indexOf(group.getAttribute('data-id')) > -1)
                    this.$(group).addClass('expanded');
                else
                    this.$(group).removeClass('expanded');
            }, this);
        },

        getGroups_pagingDone: function(data) {
            if (data.group_memberships) data.group_memberships.forEach(function(group) {
                userGroups.push(group.group_id);
            });
        },

        getUser_pagingDone: function(data) {
            if (data.roles.filter(function(role) {
                return role.configuration.ticket_access === 'all';
            }).length) {
                _showSuspended = true;
                this.$('li[data-id="suspended"]').show();
            }
        },

        getViews_fail: function() {
            _gettingViewsFailed = true;
        },

        getData: function(viewsData) {
            var that = this,
                viewsGrouped = {},
                personalViews = [],
                selected = views.current && views.current.id || null;

            if (_gettingViewsFailed) {
                services.notify(this.I18n.t('error.get_views_fail'), 'error');
            }

            if (!this.settings.noMiscFolder)
                viewsGrouped[this.settings.miscFolderName] = {};

            if (!this.settings.notPersonal)
                viewsGrouped[this.settings.personalFolderName] = {};

            /* Filter out the views we don't have access to */
            viewsData.views = viewsData.views.filter(function(view) {
                if (!view.active) {
                    return false;
                }
                if (view.restriction && view.restriction.type === 'User' && view.restriction.id !== this.currentUser().id()) {
                    return false;
                }
                if (view.restriction && view.restriction.type === 'Group' && userGroups.indexOf(view.restriction.id) === -1) {
                    return false;
                }

                return true;
            }, this);

            /* added the suspended list so it will be rendered below */
            viewsData.views.push({
                active: true,
                id: 'suspended',
                title: this.I18n.t('suspended tickets')
            });

            // Store some information in the closure about the views
            viewsData.views.forEach(function(view) {
                views[view.id] = {
                    title: view.title,
                    id: view.id,
                    restriction: view.restriction
                };

                /* If in personal folder, get the personal ones for later use */
                if (!this.settings.notPersonal && view.restriction && view.restriction.type === 'User') {
                    view.title = this.settings.personalFolderName + '::' + view.title;
                }

                var groups = view.title.split('::');
                view.title = groups.pop();
                view.groups = groups;
                buildGrouped(viewsGrouped, view);
            }, this);

            // This code is for nested views
            function buildGrouped(arr, view) {
                var groupName = view.groups.shift();

                if (!arr.len) Object.defineProperty(arr, 'len', {value: 0, writable: true, configurable: true});

                if (typeof groupName === 'undefined') {
                    // Top level view
                    if (arr === viewsGrouped && !that.settings.noMiscFolder)
                        //arr[ that.settings.miscFolderName ][view.id] = view;
                        arr[ that.settings.miscFolderName ][arr.len++] = view;
                    else
                        arr[arr.len++] = view;
                    return arr;
                }

                groupName = groupName.trim();

                arr[groupName] = arr[groupName] || {};
                arr[groupName] = buildGrouped(arr[groupName], view);

                return arr;
            }

            var t;
            if (this.settings.miscPosBottom) {
                t = viewsGrouped[ this.settings.miscFolderName ];
                delete viewsGrouped[ this.settings.miscFolderName ];
                viewsGrouped[ this.settings.miscFolderName ] = t;
            }

            if (!this.settings.notPersonal && this.settings.personalFolderPosBottom) {
                t = viewsGrouped[ this.settings.personalFolderName ];
                delete viewsGrouped[ this.settings.personalFolderName ];
                viewsGrouped[ this.settings.personalFolderName ] = t;
            }

            if (_.isEmpty(viewsGrouped[ this.settings.personalFolderName ]))
                delete viewsGrouped[ this.settings.personalFolderName ];

            if (_.isEmpty(viewsGrouped[ this.settings.miscFolderName ]))
                delete viewsGrouped[ this.settings.miscFolderName ];

            /**
             * BUILD HTML
             */
            var first = true, html = (function buildHtml(arr, i, path) {
                i = i || 0;
                return _.reduce(arr, function(html, item, index) {
                    var uPath = path ? path +'/'+ index.trim() : index.trim();
                    first = false;
                    // index is a number, this is a view.
                    if (!_.isNaN(parseFloat(index)) && isFinite(index)) {
                        return html + '<li class="filter '+ ((item.restriction && item.restriction.type === 'User' && 'foruser' || item.restriction && item.restriction.type === 'Group' && 'forgroup' || '')) + ' ' + ((selected===item.id) ? 'selected': '')+'" data-id="' +item.id+ '"><a title="'+ _.escape(item.title) +'" href="#/filters/'+item.id+'"><span class="text">'+ _.escape(item.title) +'</span><span class="count">-</span></a></li>';
                    }

                    // index is not a number, this is a group
                    // Hide count for now.
                    return html + '<li class="group" data-id="'+ _.escape(uPath) +'"><a class="group"><i class="carret"></i><span class="text">' + _.escape(index.trim()) + '</span><span class="count">-</span></a>' +buildHtml(item, ++i, uPath)+ '</li>';
                }, '<ul class="filters group">' + ((first) ? '<li class="no-result" style="display:none;">- No views found -</li>' : '')) + '</ul>';
            })(viewsGrouped);

            this.switchTo('filters', {
                viewsGroupedHTML: html
            });

            /* hide suspended views if needed */
            if (!_showSuspended) {
                this.$('li[data-id="suspended"]').hide();
            }

            this.restoreState();

            // Scroll to the right position
            this.$('[data-main]').scrollTop(views.scrollTop || 0);

            if (this.$('#lovely-search').val()) {
                this.$('#lovely-search').trigger('keyup');
            }

            this.getCount();
        },


        /**
         * Refresh counts. Run on a setInterval()
         */
        periodicRefresh: function() {
            this.$('ul.filters li.filter .count').text('-');

            /* if not visible don't actually reload */
            if (this.$(':visible').length) {
                this.getCount();
            }

        },


        /**
         * Helper to parse numbers
         */
        parseNum: function(num) {
            return (num >= 1e+9 && (num/1e+9).toFixed(1).replace('.0', '') + 'G') ||
                    (num >= 1e+8 && (num/1e+6).toFixed(0) + 'M') ||
                    (num >= 1e+6 && (num/1e+6).toFixed(1).replace('.0', '') + 'M') ||
                    (num >= 1e+5 && (num/1e+3).toFixed(0) + 'k') ||
                    (num >= 1e+3 && (num/1e+3).toFixed(1).replace('.0', '') + 'k') || // Small k, SI units :-)
                    num;
        },


        getCount_done: function(data) {
            this.$loader.hide();

            data.view_counts.forEach(function(view_count) {
                var pretty = view_count.pretty;
                // remove the tilde character from `pretty`
                if (_.isString(pretty)) pretty = pretty.slice(pretty.indexOf('~') + 1);

                var num = parseInt(view_count.value || pretty || 0, 10), rawCount = num;
                num = this.parseNum(num);

                num = _.isNaN(num) ? '-' : num;
                this.$('li[data-id="'+view_count.view_id+'"] .count').text(num).attr('data-raw-count', rawCount).attr('title', rawCount);

                if (rawCount === 0) {
                    this.$('li[data-id="'+view_count.view_id+'"]').addClass('has-zero-ticket-count');
                } else {
                    this.$('li[data-id="'+view_count.view_id+'"]').removeClass('has-zero-ticket-count');
                }

                // store this in the view array for later use
                if(typeof views[view_count.view_id] !== "undefined"){
                    views[view_count.view_id].count = rawCount;
                }
            }, this);

            // We have added all the counters. Now loop over the html list to add to the group headers
            (function recursiveCounter(item) {
                var count = 0,
                    subCount = 0;
                item.children().get().forEach(function(item) {
                    if (item.className.split(' ').indexOf('group') > -1) {
                        subCount = recursiveCounter.call(this, this.$(item).children('ul.filters'));

                        var num = subCount;
                        num = this.parseNum(num);
                        num = _.isNaN(num) ? '-' : num;

                        if (num === 0) {
                            var childrenNotRendered = false;

                            this.$(item).find('a.group:first').next().find('li.filter').each(function() {
                                if (this.className.indexOf('has-zero-ticket-count') < 0) {
                                    childrenNotRendered = true;
                                }
                            });

                            num = childrenNotRendered ? '-' : num;
                        }

                        this.$(item).find('a.group:first .count').text(num).attr('data-raw-count', subCount).attr('title', subCount);

                        count = count + subCount;
                    } else {
                        subCount = this.$(item).find('.count').attr('data-raw-count');
                        if (!subCount) return;
                        if (_.isNaN(parseInt(subCount, 10)))
                            subCount = parseInt(subCount.substr(1), 10) || 0;
                        else
                            subCount = parseInt(subCount, 10);
                        count = count + subCount;
                    }
                }, this);
                return count;
            }).call(this, this.$('ul.filters:not(.search):first'));

            this.getCount();
        },


        /**
         * Show error - is this being used?
         */
        showError: function(title, msg) {
            this.switchTo('error', {
                title: title || this.I18n.t('global.error.title'),
                message: msg || this.I18n.t('global.error.message')
            });
            throw new Error(msg);
        },

        /**
         * Gets the count of all the filters of [data-main] or $elem
         * Filters out:
         *     - elements that are not visible
         *     - elements that already have a number
         *     - elements that are not showing on the screen
         *
         * Therefor it will only try to load the count of elements that aren't loaded before
         * and the user can actually see on his screen
         */
        getCount: function() {
            var $allFilters = this.$('[data-main] > ul.filters li.filter'),
                $allVisibleFilters = this.$('[data-main] > ul.filters li.filter:visible'),
                allFilters = [];

            /* Offer additional route when we only have 15 views */
            if ($allFilters.length <= 15) {
                allFilters = $allFilters.get().filter(function(elem) {
                    var $elem = this.$(elem);
                    /* filter OUT items that already have a count */
                    if ($elem.find('.count').text() !== '-') return false;
                    return true;
                }, this);

            } else {
                allFilters = $allVisibleFilters.get().filter(function(elem) {
                    var $elem = this.$(elem),
                        $main = this.$('[data-main]');

                    /* filter OUT items that already have a count */
                    if ($elem.find('.count').text() !== '-') return false;

                    /* 10 and 20 for the margins! */
                    var docViewTop = $main.offset().top - 10;
                    var docViewBottom = docViewTop + $main.height() + 20;

                    var elemTop = $elem.offset().top;
                    var elemBottom = elemTop + $elem.height() - 10;

                    return ((elemBottom <= docViewBottom) && (elemTop >= docViewTop));
                }, this);
            }

            var ids = allFilters.map(function(filter) { return filter.getAttribute('data-id'); });

            if (ids.length)
                this.$loader.show();
            else
                this.$loader.hide();

            ids = ids.length ? ids : 'reset';
            this.ajax_getCount(ids);
        },

        ajax_getCount: llHelpers.throttle(function(ids) {
            /* Only get 25 max ! */
            ids = ids.slice(0, 25);
            if (ids.join && ids.length) this.ajax_getCount('set_wait', 2500+(300*ids.length));
            return this.ajax('getCount', ids);
        }, 10 * 1000, {leading: true, trailing: true}),

        /**
         * this.ajax_paging('getViews').done().fail()
         *   .done and .fail run once at the very end.
         *
         * events: {
         *   'getViews.done' - Run after *every* page
         *   'getViews.fail' - Run after *every* page
         *   'getViews.paging_done' - Run once at the very end
         *   'getViews.paging_fail' - Run once at the very end
         * }
         *
         * If the .fail get triggered, it still tried to continue to the next page or run .paging_fail.
         * It cannot continue when it's either the first page or when it has two consecutive fails.
         */
        ajax_paging: function() {
            var args = Array.prototype.slice.call(arguments, 0),
                promise = this.$().constructor.Deferred(),
                all_data = [],
                last_next_page = null;

            function done(d) {
                /*jshint validthis: true */
                /* Don't run the first time because Zendesk's framework already does that for us */
                if (all_data.length && this.events[args[0] + '.done']) {
                    if (typeof this.events[args[0] + '.done'] === 'function') this.events[args[0] + '.done'].apply(this, arguments);
                    else if (typeof this.events[args[0] + '.done'] === 'string') this[ this.events[args[0] + '.done'] ].apply(this, arguments);
                }

                all_data.push(d);
                if (d.next_page) {
                    last_next_page = d.next_page;
                    this.ajax('getNextPage', d.next_page).done(done).fail(fail);

                } else {
                    var grouped_data = _.reduce(all_data, function(grouped_data, sub_data) {
                            _.forEach(sub_data, function(value, key) {
                                if (key === 'next_page' || key === 'previous_page') return;
                                grouped_data[key] = (grouped_data[key] instanceof Array) ? grouped_data[key].concat(value) : value;
                            });
                            return grouped_data;
                        }, {});

                    if (typeof this.events[args[0] + '.paging_done'] === 'function') this.events[args[0] + '.paging_done'].apply(this, [grouped_data]);
                    else if (typeof this.events[args[0] + '.paging_done'] === 'string') this[ this.events[args[0] + '.paging_done'] ].apply(this, [grouped_data]);
                    promise.resolveWith(this, [grouped_data]);
                }
            }

            function fail() {
                /*jshint validthis: true */
                /* Don't run the first time because Zendesk's framework already does that for us */
                if (all_data.length && this.events[args[0] + '.fail']) {
                    if (typeof this.events[args[0] + '.fail'] === 'function') this.events[args[0] + '.fail'].apply(this, arguments);
                    else if (typeof this.events[args[0] + '.fail'] === 'string') this[ this.events[args[0] + '.fail'] ].apply(this, arguments);
                }

                if (last_next_page) {
                    var next_page = last_next_page.replace(/([?|&])page=(\d+)/, function(match, connector, page) { return connector + 'page=' + (+page + 1); });
                    last_next_page = null;
                    this.ajax('getNextPage', next_page).done(done).fail(fail);

                } else {
                    if (typeof this.events[args[0] + '.paging_fail'] === 'function') this.events[args[0] + '.paging_fail'].apply(this, arguments);
                    else if (typeof this.events[args[0] + '.paging_fail'] === 'string') this[ this.events[args[0] + '.paging_fail'] ].apply(this, arguments);
                    promise.rejectWith(this, arguments);
                }
            }

            this.ajax.apply(this, args).done(done).fail(fail);

            return promise;
        }
    };
}());
;
}
var app = ZendeskApps.defineApp(source)
  .reopenClass({"location":{"support":{"top_bar":"_legacy"}},"noTemplate":[],"singleInstall":true,"signedUrls":false})
  .reopen({
    appName: "Quickie",
    appVersion: "1.1.8",
    assetUrlPrefix: "https://33631.apps.zdusercontent.com/33631/assets/1474409388-977d338521d2ad1391ec348cd2795a79/",
    appClassName: "app-33631",
    author: {
      name: "Lovestock \u0026 Leaf",
      email: "apps@lovestockleaf.com"
    },
    translations: {"app":{"parameters":{"noMiscFolder":{"label":"Don't place root level views in 'Misc' folder"},"miscFolderName":{"label":"Rename 'Misc' folder to"},"miscPosBottom":{"label":"Place 'Misc' folder/views at bottom of list"},"notPersonal":{"label":"Don't place personal views in 'Personal' folder"},"personalFolderName":{"label":"Rename 'Personal' folder to"},"personalFolderPosBottom":{"label":"Place 'Personal' folder/views at bottom of list"}}},"Misc":"Misc","Personal":"Personal","lovestockleaf":"Lovestock \u0026 Leaf","lovestockleaf-tooltip":"Go to Lovestock \u0026 Leaf for more lovely apps!","refresh":"Refresh","suspended tickets":"Suspended tickets","collapse all":"Collapse all","expand all":"Expand all","error":{"xhr_fail":"Still trying to fetch the views...","get_views_fail":"\u003cb\u003eQuickie\u003c/b\u003e\u003cbr\u003eCould not fetch some views."}},
    templates: {"filters":"{{{viewsGroupedHTML}}}","layout":"\u003cstyle\u003e\n.app-33631 {\n  /* Retina Support */ }\n  .app-33631 header .logo {\n    background-image: url(\"https://33631.apps.zdusercontent.com/33631/assets/1474409388-977d338521d2ad1391ec348cd2795a79/logo-small.png\"); }\n  .app-33631 header {\n    background: url(\"https://33631.apps.zdusercontent.com/33631/assets/1474409388-977d338521d2ad1391ec348cd2795a79/metal-background.gif\") 0 0; }\n    .app-33631 header h1 {\n      margin-left: 10px;\n      font-size: 14px; }\n    .app-33631 header .refresh {\n      margin: 12px 15px 0 24px;\n      padding: 0;\n      float: right; }\n      .app-33631 header .refresh i {\n        background: url(\"https://33631.apps.zdusercontent.com/33631/assets/1474409388-977d338521d2ad1391ec348cd2795a79/lovelymenu-sprite.png\") no-repeat -4px -61px;\n        width: 14px;\n        height: 13px; }\n      .app-33631 header .refresh i:hover {\n        background-position: -42px -61px; }\n    .app-33631 header .expanding {\n      margin: 12px 10px 0 0;\n      padding: 0;\n      float: right;\n      font-weight: bold; }\n      .app-33631 header .expanding i {\n        background: url(\"https://33631.apps.zdusercontent.com/33631/assets/1474409388-977d338521d2ad1391ec348cd2795a79/lovelymenu-sprite.png\") no-repeat 0 -207px;\n        width: 13px;\n        height: 13px; }\n      .app-33631 header .expanding i:hover {\n        background-position: 0 -226px; }\n    .app-33631 header .collapsing {\n      margin: 12px 0 0 0;\n      padding: 0;\n      float: right;\n      font-weight: bold; }\n      .app-33631 header .collapsing i {\n        background: url(\"https://33631.apps.zdusercontent.com/33631/assets/1474409388-977d338521d2ad1391ec348cd2795a79/lovelymenu-sprite.png\") no-repeat -18px -207px;\n        width: 13px;\n        height: 13px; }\n      .app-33631 header .collapsing i:hover {\n        background-position: -18px -226px; }\n  .app-33631 div.loading, .app-33631 div.xhr_fail {\n    text-align: center; }\n  .app-33631 input#lovely-search {\n    width: 256px;\n    padding: 4px 4px 4px 10px;\n    border: 0;\n    border-bottom: 1px solid #e0e0e0;\n    border-radius: 0; }\n  .app-33631 [data-main] {\n    background-color: #f8f8f8 !important;\n    /* need improtant to overwrite default style */ }\n  .app-33631 .scroll_content {\n    overflow-x: hidden; }\n  .app-33631 .popover-inner [data-main] {\n    padding-right: 0;\n    padding-left: 0; }\n  .app-33631 ul.filters {\n    margin: 0;\n    /* Hide group count when expanded */\n    /* OTHER CARRET STATES */ }\n    .app-33631 ul.filters a {\n      display: block;\n      position: relative;\n      color: #555; }\n    .app-33631 ul.filters .highlight {\n      /* background-color: #fbf9cc; /* latest */\n      background-color: #F8EB8D; }\n    .app-33631 ul.filters .count {\n      position: absolute;\n      right: 7px;\n      width: 29px;\n      color: #777;\n      text-align: center;\n      font-size: 10px;\n      padding: 1px 2px;\n      opacity: 1;\n      margin-top: -1px;\n      font-style: normal; }\n    .app-33631 ul.filters li.filter {\n      /*border-bottom: 1px solid transparent;*/\n      /*padding-bottom: 1px;\n      margin-bottom: 1px;*/ }\n    .app-33631 ul.filters li.filter:hover {\n      background-color: #ebebeb; }\n    .app-33631 ul.filters li.no-result {\n      text-align: center; }\n    .app-33631 ul.filters li.filter.selected {\n      background-image: none;\n      outline: none;\n      font-weight: bold;\n      background-color: #ebebeb;\n      border-top: 0;\n      color: #333; }\n    .app-33631 ul.filters li.filter \u003e a {\n      overflow: hidden;\n      white-space: nowrap;\n      text-overflow: ellipsis;\n      padding-right: 41px; }\n    .app-33631 ul.filters li.filter.has-zero-ticket-count \u003e a {\n      color: #BBB; }\n    .app-33631 ul.filters li.filter.has-zero-ticket-count \u003e a .count {\n      opacity: 0.5; }\n    .app-33631 ul.filters li[data-id=\"suspended\"].selected a, .app-33631 ul.filters li[data-id=\"suspended\"].selected span, .app-33631 ul.filters li[data-id=\"suspended\"]:not(.has-zero-ticket-count) a, .app-33631 ul.filters li[data-id=\"suspended\"]:not(.has-zero-ticket-count) span {\n      color: #bd322c; }\n    .app-33631 ul.filters li.filter.foruser {\n      font-style: italic; }\n    .app-33631 ul.filters a.group {\n      font-size: 12px;\n      color: #797979;\n      margin-top: 4px;\n      margin-bottom: 4px;\n      font-weight: bold;\n      color: #666; }\n      .app-33631 ul.filters a.group .carret {\n        /* non hover, collapsed */\n        display: inline-block;\n        width: 11px;\n        margin-right: 4px;\n        height: 13px;\n        background: url(\"https://33631.apps.zdusercontent.com/33631/assets/1474409388-977d338521d2ad1391ec348cd2795a79/lovelymenu-sprite.png\") 3px -183px no-repeat; }\n      .app-33631 ul.filters a.group .count {\n        text-align: center;\n        font-size: 9px;\n        border-radius: 8px;\n        box-shadow: 0px 1px 0px 0px #ccc;\n        background-color: white; }\n    .app-33631 ul.filters li.group ul.filters {\n      display: none; }\n    .app-33631 ul.filters li.group.expanded \u003e ul.filters {\n      display: block; }\n    .app-33631 ul.filters li.group.expanded \u003e a.group .count {\n      display: none; }\n    .app-33631 ul.filters li.group.expanded \u003e a.group .carret {\n      /* non hover, expanded */\n      background-position: -21px -183px; }\n    .app-33631 ul.filters a.group:hover .carret {\n      /* hover, collapsed */\n      background-position: 3px -168px; }\n    .app-33631 ul.filters li.group.expanded \u003e a.group:hover .carret {\n      /* hover, expanded */\n      background-position: -21px -168px; }\n  .app-33631 ul.filters \u003e li.filter, .app-33631 ul.filters a.group {\n    padding-left: 10px; }\n  .app-33631 ul.filters ul.filters \u003e li.filter, .app-33631 ul.filters ul.filters a.group {\n    padding-left: 25px; }\n  .app-33631 ul.filters ul.filters ul.filters \u003e li.filter, .app-33631 ul.filters ul.filters ul.filters a.group {\n    padding-left: 40px; }\n  .app-33631 ul.filters ul.filters ul.filters ul.filters \u003e li.filter, .app-33631 ul.filters ul.filters ul.filters ul.filters a.group {\n    padding-left: 55px; }\n  .app-33631 ul.filters ul.filters ul.filters ul.filters ul.filters \u003e li.filter, .app-33631 ul.filters ul.filters ul.filters ul.filters ul.filters a.group {\n    padding-left: 70px; }\n  .app-33631 ul.filters ul.filters ul.filters ul.filters ul.filters ul.filters \u003e li.filter, .app-33631 ul.filters ul.filters ul.filters ul.filters ul.filters ul.filters a.group {\n    padding-left: 85px; }\n  .app-33631 ul.filters ul.filters ul.filters ul.filters ul.filters ul.filters ul.filters \u003e li.filter, .app-33631 ul.filters ul.filters ul.filters ul.filters ul.filters ul.filters ul.filters a.group {\n    padding-left: 100px; }\n  .app-33631 \u003e ul.filters li.group:hover {\n    background-color: transparent !important; }\n  .app-33631 span.filter_search {\n    float: right;\n    margin: 5px 10px 0 0;\n    position: relative; }\n  .app-33631 #filter_search {\n    padding-left: 24px;\n    width: 450px; }\n  .app-33631 .shortDescription td {\n    color: #777;\n    cursor: auto; }\n  .app-33631 ul.filters li.filter a {\n    padding-bottom: 2px !important;\n    padding-top: 2px !important; }\n  .app-33631 .edit_view {\n    display: none; }\n  .app-33631 #view-order select {\n    border: 1px solid #aaa;\n    margin-top: 5px;\n    margin-right: 5px;\n    margin-bottom: 12px; }\n  .app-33631 .showSpinner {\n    display: inline-block !important;\n    height: 19px; }\n  .app-33631 footer {\n    padding: 10px 10px 5px 10px !important;\n    height: 23px;\n    border-top: 1px solid #E2E2E2;\n    background: url(\"https://33631.apps.zdusercontent.com/33631/assets/1474409388-977d338521d2ad1391ec348cd2795a79/metal-background.gif\") 0 0; }\n    .app-33631 footer a.lovestockleaf-link {\n      display: block;\n      background: url(\"https://33631.apps.zdusercontent.com/33631/assets/1474409388-977d338521d2ad1391ec348cd2795a79/lovelymenu-sprite.png\") no-repeat 0 -31px;\n      width: 100%;\n      height: 23px; }\n    .app-33631 footer a.lovestockleaf-link:hover {\n      background-position: 0 0; }\n  @media only screen and (-webkit-min-device-pixel-ratio: 2), only screen and (min--moz-device-pixel-ratio: 2), only screen and (-o-min-device-pixel-ratio: 2 / 1), only screen and (min-device-pixel-ratio: 2), only screen and (min-resolution: 192dpi), only screen and (min-resolution: 2dppx) {\n    .app-33631 footer a.lovestockleaf-link {\n      background: url(\"https://33631.apps.zdusercontent.com/33631/assets/1474409388-977d338521d2ad1391ec348cd2795a79/lovelymenu-sprite-retina.png\") 0 -31px no-repeat;\n      background-size: 87.5px 249.5px; }\n    .app-33631 footer a.lovestockleaf-link:hover {\n      background-position: 0 0; }\n    .app-33631 ul.filters a.group .carret {\n      background: url(\"https://33631.apps.zdusercontent.com/33631/assets/1474409388-977d338521d2ad1391ec348cd2795a79/lovelymenu-sprite-retina.png\") 3px -183px no-repeat;\n      background-size: 87.5px 249.5px; }\n    .app-33631 ul.filters li.group.expanded \u003e a.group .carret {\n      background-position: -21px -183px; }\n    .app-33631 ul.filters a.group:hover .carret {\n      background-position: 3px -168px; }\n    .app-33631 ul.filters li.group.expanded \u003e a.group:hover .carret {\n      background-position: -21px -168px; }\n    .app-33631 header .refresh i {\n      background: url(\"https://33631.apps.zdusercontent.com/33631/assets/1474409388-977d338521d2ad1391ec348cd2795a79/lovelymenu-sprite-retina.png\") 0px -61.5px no-repeat;\n      background-size: 87.5px 249.5px; }\n    .app-33631 header .refresh i:hover {\n      background-position: -36.5px -61.5px; }\n    .app-33631 header .expanding i {\n      background: url(\"https://33631.apps.zdusercontent.com/33631/assets/1474409388-977d338521d2ad1391ec348cd2795a79/lovelymenu-sprite-retina.png\") no-repeat 0 -207px;\n      background-size: 87.5px 249.5px; }\n    .app-33631 header .expanding i:hover {\n      background-position: 0 -226px; }\n    .app-33631 header .collapsing i {\n      background: url(\"https://33631.apps.zdusercontent.com/33631/assets/1474409388-977d338521d2ad1391ec348cd2795a79/lovelymenu-sprite-retina.png\") no-repeat -18px -207px;\n      background-size: 87.5px 249.5px; }\n    .app-33631 header .collapsing i:hover {\n      background-position: -18px -226px; } }\n\u003c/style\u003e\n\u003cheader\u003e\n    \u003ch1\u003e\n        \u003cbutton tabindex=\"-1\" class=\"refresh action_button\" title=\"{{t \"refresh\"}}\"\u003e\n            \u003ci class=\"icon-refresh\"\u003e\u003c/i\u003e\n        \u003c/button\u003e\n        \u003cbutton tabindex=\"-1\" class=\"collapsing action_button\" title=\"{{t \"collapse all\"}}\"\u003e\n            \u003ci class=\"icon-collapse\"\u003e\u003c/i\u003e\n        \u003c/button\u003e\n        \u003cbutton tabindex=\"-1\" class=\"expanding action_button\" title=\"{{t \"expand all\"}}\"\u003e\n            \u003ci class=\"icon-expand\"\u003e\u003c/i\u003e\n        \u003c/button\u003e\n        \u003cspan\u003e{{setting \"name\"}}\u003c/span\u003e\n\n        \u003ci style=\"display: inline-block;\" class=\"icon-loading-spinner lazy-loader\"\u003e\u003c/i\u003e\n    \u003c/h1\u003e\n\u003c/header\u003e\n\n\u003cinput type=\"search\" class=\"highlightable\" id=\"lovely-search\" placeholder=\"Search ticket views\" autocomplete=\"off\" /\u003e\n\n\u003cdiv class=\"scroll_content\" data-main /\u003e\n\n\u003cfooter\u003e\u003ca title=\"{{t \"lovestockleaf-tooltip\"}}\" target=\"_blank\" class=\"lovestockleaf-link\" href=\"http://www.lovestockleaf.com/zendesk/?a=quickie\" alt=\"{{t \"lovestockleaf\"}}\"\u003e\u003c/a\u003e\u003c/footer\u003e","loading":"\u003cdiv class=\"loading\"\u003e\n    \u003ci style=\"display: inline-block;\" class=\"icon-loading-spinner\"\u003e\u003c/i\u003e\n\u003c/div\u003e","xhr_fail":"\u003cdiv class=\"xhr_fail\"\u003e\n    \u003ci style=\"display: inline-block;\" class=\"icon-loading-spinner\"\u003e\u003c/i\u003e\u003cbr/\u003e\n    {{t \"error.xhr_fail\"}}\n\u003c/div\u003e"},
    frameworkVersion: "1.0"
  });

ZendeskApps["Quickie"] = app;

    with( ZendeskApps.AppScope.create() ) {

  var source = (function() {

    return {
        events: {
            'app.activated': 'doSomething',
            'change input[type="checkbox"]': function() {

            }
        },

        doSomething: function() {}
    };

}());
;
}
var app = ZendeskApps.defineApp(source)
  .reopenClass({"location":{"support":{"ticket_sidebar":"_legacy","new_ticket_sidebar":"_legacy"}},"noTemplate":[],"singleInstall":false,"signedUrls":false})
  .reopen({
    appName: "Resources Search",
    appVersion: "1.1.0",
    assetUrlPrefix: "https://96853.apps.zdusercontent.com/96853/assets/1475004492-3dbbb01a7fdd2734dd4f0295c40f70ab/",
    appClassName: "app-96853",
    author: {
      name: "Mike Martello",
      email: "michael.martello@getbraintree.com"
    },
    translations: {"app":{"description":"Play the famous zen tunes in your help desk.","name":"Buddha Machine"},"loading":"Welcome to this Sample App","fetch":{"done":"Good","fail":"failed to fecth information from the server"},"id":"ID","email":"Email","role":"Role","groups":"Groups"},
    templates: {"layout":"\u003cstyle\u003e\n.app-96853 header .logo {\n  background-image: url(\"https://96853.apps.zdusercontent.com/96853/assets/1475004492-3dbbb01a7fdd2734dd4f0295c40f70ab/logo-small.png\"); }\n.app-96853 .options {\n  font-size: 12px;\n  margin: 10px 0 10px 0; }\n.app-96853 .options td {\n  padding-right: 10px; }\n.app-96853 input[type=submit] {\n  padding: 5px 15px;\n  background: #ccc;\n  border: 0 none;\n  cursor: pointer;\n  -webkit-border-radius: 5px;\n  border-radius: 5px;\n  font-size: 12px; }\n\u003c/style\u003e\n\u003csection data-main\u003e\n\t\u003ch3\u003eBT Support Articles\u003c/h3\u003e\n\t\t\u003cform action = \"https://cse.google.com/cse\" target=\"_blank\"\u003e\n\t\t\t\u003cinput type=\"text\" size=\"32\" style=\"width: 232px;\" name=\"q\"\u003e\u003cinput type=\"hidden\" class=\"cx\" name=\"cx\" value=\"004252214850769841598:g1wmo0kkknw\"\u003e\u003cinput type=\"hidden\" class=\"gsc.q\" name=\"gsc.q value=\"search\"\u003e\t\u003cinput type=\"submit\" value=\"Search\"\u003e\n\t\t\u003c/form\u003e\n\t\t\u003cp\u003e\u0026nbsp\u003c/p\u003e\n\t\u003ch3\u003eDeveloper Docs\u003c/h3\u003e\n\t\t\u003cdiv id=\"tfheader\"\u003e\n\t\t\t\u003cform id=\"tfnewsearch\" method=\"get\" action=\"https://developers.braintreepayments.com\" target=\"_blank\"\u003e\n\t\t\t\t\u003cinput type=\"text\" class=\"tftextinput\" id=\"tftextinput\" name=\"q\" size=\"32\" style=\"width: 232px;\"\u003e\t\u003cinput type=\"submit\" value=\"Search\" class=\"tfbutton\"\u003e\n\t\t\t\u003c/form\u003e\n\t\t\u003cdiv class=\"tfclear\"\u003e\u003c/div\u003e\n\t\t\u003c/div\u003e\n\n\t\t\u003cscript\u003e\n\t\t\tvar a = document.getElementById('tfnewsearch');\n\t\t\ta.addEventListener('submit',function(e) {\n\t\t\t\te.preventDefault();\n\t\t\t\tvar b = document.getElementById('tftextinput').value;\n\t\t\t\twindow.open('https://developers.braintreepayments.com/search/'+b, '_blank');\n\n\t\t\t});\n\n\t\t\u003c/script\u003e\n\t\u003cp\u003e\u0026nbsp\u003c/p\u003e\n\t\u003ch3\u003eSalesforce\u003c/h3\u003e\n\t\t\u003cform action = \"https://braintree.my.salesforce.com/_ui/search/ui/UnifiedSearchResults\" target=\"_blank\"\u003e\n\t\t\t\u003cinput type=\"text\" size=\"32\" style=\"width: 232px;\" name=\"str\"\u003e\t\u003cinput type=\"submit\" value=\"Search\"\u003e\n\t\t\u003c/form\u003e\n\t\u003cp\u003e\u0026nbsp\u003c/p\u003e\n\t\u003ch3\u003eThe Wiki\u003c/h3\u003e\n\t\t\u003cform action = \"https://internal.braintreepayments.com/dosearchsite.action\" target=\"_blank\"\u003e\n\t\t\t\u003cinput type=\"text\" size=\"32\" style=\"width: 232px;\" name=\"queryString\"\u003e\t\u003cinput type=\"submit\" value=\"Search\"\u003e\n\t\t\t\u003c!-- \u003cp\u003e\u003cinput type=\"checkbox\" name=\"type\" value=\"attachment\" class=\"content\"\u003e Search Attachments Only\u003c/p\u003e --\u003e\n\t\t\t\u003cp\u003e\u003cfont color=\"A2A2A0\"\u003e\u003ci\u003eYou may need to log in if no results are found.\u003c/i\u003e\u003c/font\u003e\u003c/p\u003e\n\t\t\u003c/form\u003e\n\t\u003cp\u003e\u0026nbsp\u003c/p\u003e\n\t\u003ch3\u003eOld Desk.com Tickets\u003c/h3\u003e\n\t\t\u003cform action = \"https://braintreepaymentstemp.zendesk.com/search\" target=\"_blank\"\u003e\n\t\t\t\u003cp\u003e\u003cinput type=\"text\" size=\"37\" style=\"width: 232px;\" name=\"query\" value=\"fieldvalue:\" onblur=\"this.value=removeSpaces(this.value);\"\u003e\t\u003cinput type=\"submit\" value=\"Search\"\u003e\u003c/p\u003e\n\t\t\t\u003cp\u003e\u003cfont color=\"A2A2A0\"\u003e\u003ci\u003ePaste ticket number after \"fieldvalue:\" for refined search.\u003c/i\u003e\u003c/font\u003e\u003c/p\u003e\n\t\t\t\t\u003cscript language=\"javascript\" type=\"text/javascript\"\u003e\n\t\t\t\t\tfunction removeSpaces(string) {\n\t\t\t\t\treturn string.split(' ').join('');\n\t\t\t\t\t}\n\t\t\t\t\u003c/script\u003e\n\t\t\u003c/form\u003e\n\u003c/section\u003e"},
    frameworkVersion: "1.0"
  });

ZendeskApps["Resources Search"] = app;

    with( ZendeskApps.AppScope.create() ) {

  var source = (function () {

  var DEFAULT_DELAY = 5,
      cancelMessage,
      cancelledMessage,
      tickTimer,
      stopped,
      delay;

  return {
    events: {
      'app.activated': 'init',
      'ticket.save': 'save',
      'ticket.submit.always': 'cleanTimer',
      'click #cancel-ticket-submit': 'cancel',
      'zd_ui_change .delay-settings-dropdown': 'updateSettings'
    },

    init: function () {
      cancelMessage = helpers.fmt("<a tabindex='-1' onclick='$(\"#cancel-ticket-submit\").trigger(\"click\");'><strong>%@</strong></a>", this.I18n.t('cancelMessage'));
      cancelledMessage = this.I18n.t('cancelledMessage');
      delay = this.getDelay();
      this.store({'ticketSubmissionUserDelay': delay});

      this.switchTo('settings');
      this.$('.delay-settings-dropdown').zdSelectMenu('setValue', delay);
      if (!this.setting('allow_agents_choose_timeout')) {
        this.hide();
      }
    },

    updateSettings: function () {
      var userDelay = parseInt(this.$('.delay-settings-dropdown').zdSelectMenu('value'), 10);
      this.store({'ticketSubmissionUserDelay': userDelay});
    },

    cancel: function() {
      stopped = true;
    },

    cleanTimer: function () {
      clearInterval(tickTimer);
    },

    save: function () {
      var tick = this.getDelay();
      // bail out if delay set to off
      if (tick <= 0) { return; }

      stopped = false;
      services.notify(cancelMessage, 'alert', tick * 1000);

      return this.promise(function (done, fail) {
        tickTimer = setInterval(function () {
          if (stopped) {
            clearInterval(tickTimer);
            fail(cancelledMessage);
          } else {
            tick--;
            if (tick === 0) {
              clearInterval(tickTimer);
              done();
            }
          }
        }, 1000);
      });
    },

    getDelay: function () {
      var myDelay = this.store('ticketSubmissionUserDelay');
      if (myDelay !== 0 && !myDelay) {
        myDelay = DEFAULT_DELAY;
      }

      return myDelay;
    }
  };
}());
;
}
var app = ZendeskApps.defineApp(source)
  .reopenClass({"location":{"support":{"ticket_sidebar":"_legacy"}},"noTemplate":[],"singleInstall":false,"signedUrls":false})
  .reopen({
    appName: "Undo Send",
    appVersion: "1.0",
    assetUrlPrefix: "https://97431.apps.zdusercontent.com/97431/assets/1473702471-904660f88393cbfcef31270c757f2270/",
    appClassName: "app-97431",
    author: {
      name: "Likun Liu",
      email: "lliu@zendesk.com"
    },
    translations: {"app":{"description":"Cancel a ticket submission!","name":"Oopsie!","parameters":{"allow_agents_choose_timeout":{"label":"Allow each agent to select his own timeout to cancel a ticket submission","helpText":"Each agent can choose his own timeout if you enable this option, otherwise the timeout is set to 10 seconds for everyone."}}},"cancelMessage":"Cancel submission","cancelledMessage":"Your ticket submission was cancelled","delaySecondsOptionLabel":"Ticket submission delay seconds","delaySecondsOptionOff":"Off"},
    templates: {"layout":"\u003cstyle\u003e\n.app-97431 header .logo {\n  background-image: url(\"https://97431.apps.zdusercontent.com/97431/assets/1473702471-904660f88393cbfcef31270c757f2270/logo-small.png\"); }\n.app-97431 .delay-settings-label {\n  float: left;\n  margin-top: 5px; }\n.app-97431 .delay-settings-dropdown {\n  float: left;\n  margin-left: 10px; }\n\u003c/style\u003e\n\u003cheader\u003e\n  \u003cspan class=\"logo\"/\u003e\n  \u003ch3\u003e{{setting \"name\"}}\u003c/h3\u003e\n\u003c/header\u003e\n\u003csection data-main\u003e\n\u003c/section\u003e","settings":"\u003cdiv class='delay-settings'\u003e\n  \u003cspan class='delay-settings-label'\u003e{{t \"delaySecondsOptionLabel\"}}\u003c/span\u003e\n  \u003cselect class='delay-settings-dropdown' data-zd-type=\"select_menu\"\u003e\n    \u003coption value=\"0\"\u003e{{t \"delaySecondsOptionOff\"}}\u003c/option\u003e\n    \u003coption value=\"3\"\u003e3\u003c/option\u003e\n    \u003coption value=\"5\"\u003e5\u003c/option\u003e\n    \u003coption value=\"7\"\u003e7\u003c/option\u003e\n    \u003coption value=\"10\"\u003e10\u003c/option\u003e\n  \u003c/select\u003e\n\u003c/div\u003e\n\u003cdiv id='cancel-ticket-submit'\u003e\u003c/div\u003e"},
    frameworkVersion: "1.0"
  });

ZendeskApps["Undo Send"] = app;

    with( ZendeskApps.AppScope.create() ) {

  var source = (function() {
  return {

    TICKET_STATUSES: ['new', 'open', 'solved', 'pending', 'hold', 'closed'],

    events: {
      // App
      'app.created': 'init',
      'ticket.requester.email.changed': 'onRequesterEmailChanged',

      // Requests
      'getUser.done': 'onGetUserDone',
      'getLocales.done': 'onGetLocalesDone',
      'getUserFields.done': 'onGetUserFieldsDone',
      'getOrganizationFields.done': 'onGetOrganizationFieldsDone',
      'getTickets.done': 'onGetTicketsDone',
      'searchTickets.done': 'onSearchTicketsDone',
      'getOrganizationTickets.done': 'onGetOrganizationTicketsDone',
      'getTicketAudits.done': 'getTicketAuditsDone',
      'getCustomRoles.done': 'onGetCustomRolesDone',

      // UI
      'click .expand-bar': 'onClickExpandBar',
      'click .cog': 'onCogClick',
      'click .back': 'onBackClick',
      'click .save': 'onSaveClick',
      'change .org-fields-activate': 'onActivateOrgFieldsChange',
      'change,keyup,input,paste .notes-or-details': 'onNotesOrDetailsChanged',

      // Misc
      'requestsFinished': 'onRequestsFinished'
    },

    requests: {
      getLocales: {
        url: '/api/v2/locales.json'
      },

      getOrganizationFields: {
        url: '/api/v2/organization_fields.json'
      },

      getOrganizationTickets: function(orgId) {
        return {
          url: helpers.fmt('/api/v2/organizations/%@/tickets.json', orgId)
        };
      },

      getTicketAudits: function(id){
        return {
          url: helpers.fmt('/api/v2/tickets/%@/audits.json', id),
          dataType: 'json'
        };
      },

      getTickets: function(userId, page) {
        page = page || 1;
        return {
          url: helpers.fmt('/api/v2/users/%@/tickets/requested.json?page=%@', userId, page)
        };
      },

      searchTickets: function(userId, status) {
        return {
          url: helpers.fmt('/api/v2/search.json?query=type:ticket requester:%@ status:%@', userId, status),
          dataType: 'json'
        };
      },

      getUser: function(userId) {
        return {
          url: helpers.fmt('/api/v2/users/%@.json?include=identities,organizations', userId),
          dataType: 'json'
        };
      },

      getCustomRoles: {
        url: '/api/v2/custom_roles.json',
        dataType: 'json'
      },

      getUserFields: {
        url: '/api/v2/user_fields.json'
      },

      saveSelectedFields: function(keys, orgKeys) {
        var appId = this.installationId();
        var settings = {
          'selectedFields': JSON.stringify(_.toArray(keys)),
          'orgFieldsActivated': this.storage.orgFieldsActivated.toString(),
          'orgFields': JSON.stringify(_.toArray(orgKeys))
        };
        this.settings = _.extend(this.settings, settings);
        return {
          type: 'PUT',
          url: helpers.fmt('/api/v2/apps/installations/%@.json', appId),
          dataType: 'json',
          data: {
            'settings': settings,
            'enabled': true
          }
        };
      },

      updateNotesOrDetails: function(type, id, data) {
        return {
          url: helpers.fmt('/api/v2/%@/%@.json', type, id),
          type: 'PUT',
          dataType: 'json',
          data: data
        };
      }
    },

    // TOOLS ===================================================================

    // Implement the partial() method of underscorejs, because 1.3.3 doesn't
    // include it.
    partial: function(func) {
      var args = Array.prototype.slice.call(arguments, 1);
      return function() {
        return func.apply(this,
                          args.concat(Array.prototype.slice.call(arguments)));
      };
    },

    // Implement the object() method of underscorejs, because 1.3.3 doesn't
    // include it. Simplified for our use.
    toObject: function(list) {
      if (list == null) return {};
      var result = {};
      for (var i = 0, l = list.length; i < l; i++) {
        result[list[i][0]] = list[i][1];
      }
      return result;
    },

    countedAjax: function() {
      this.storage.requestsCount++;
      return this.ajax.apply(this, arguments).always((function() {
        _.defer((this.finishedAjax).bind(this));
      }).bind(this));
    },

    finishedAjax: function() {
      if (--this.storage.requestsCount === 0) {
        this.trigger('requestsFinished');
      }
    },

    fieldsForCurrent: function(target, fields, selected, values) {
      return _.compact(_.map(selected, (function(key) {
        var field = _.find(fields, function(field) {
          return field.key === key;
        });
        if (!field) {
          return null;
        }
        var result = {
          key: key,
          description: field.description,
          title: field.title,
          editable: field.editable
        };
        if (key.indexOf('##builtin') === 0) {
          var subkey = key.split('_')[1];
          result.name = subkey;
          result.value = target[subkey];
          result.simpleKey = ['builtin', subkey].join(' ');
          if (subkey === 'tags') {
            result.value = this.renderTemplate('tags', {tags: result.value});
            result.html = true;
          } else if (subkey === 'locale') {
            result.value = this.storage.locales[result.value];
          } else if (!result.editable) {
            result.value = _.escape(result.value).replace(/\n/g,'<br>');
            result.html = true;
          }
        }
        else {
          result.simpleKey = ['custom', key].join(' ');
          result.value = values[key];
          if (field.type === 'date') {
            result.value = (result.value ? this.toLocaleDate(result.value) : '');
          } else if(!result.editable && values[key]) {
            result.value = _.escape(values[key]).replace(/\n/g,'<br>');
            result.html = true;
          }
        }
        return result;
      }).bind(this)));
    },

    fieldsForCurrentOrg: function() {
      if (!this.storage.user || !this.storage.user.organization) {
        return {};
      }
      return this.fieldsForCurrent(this.storage.user.organization,
                                   this.storage.organizationFields,
                                   this.storage.selectedOrgKeys,
                                   this.storage.user.organization.organization_fields);
    },

    fieldsForCurrentUser: function() {
      if (!this.storage.user) {
        return {};
      }
      return this.fieldsForCurrent(this.storage.user,
                                   this.storage.fields,
                                   this.storage.selectedKeys,
                                   this.storage.user.user_fields);
    },

    toLocaleDate: function(date) {
      return moment(date).utc().format('l');      
    },

    showDisplay: function() {
      this.switchTo('display', {
        ticketId: this.ticket().id(),
        isAdmin: this.currentUser().role() === 'admin',
        user: this.storage.user,
        tickets: this.makeTicketsLinks(this.storage.ticketsCounters),
        fields: this.fieldsForCurrentUser(),
        orgFields: this.fieldsForCurrentOrg(),
        orgFieldsActivated: this.storage.user && this.storage.orgFieldsActivated && this.storage.user.organization,
        org: this.storage.user && this.storage.user.organization,
        orgTickets: this.makeTicketsLinks(this.storage.orgTicketsCounters)
      });
      if (this.storage.spokeData) {
        this.displaySpoke();
      }
      if (this.store('expanded')) {
        this.onClickExpandBar(true);
      }
    },

    makeTicketsLinks: function(counters) {
      var links = {};
      var link = '#/tickets/%@/requester/requested_tickets'.fmt(this.ticket().id());
      var tag = this.$('<div>').append(this.$('<a>').attr('href', link));
      _.each(counters, function(value, key) {
        if (value && value !== '-') {
          tag.find('a').html(value);
          links[key] = tag.html();
        }
        else {
          links[key] = value;
        }
      }.bind(this));
      return links;
    },

    setEditable: function() {
      var role = this.currentUser().role();
      this.orgEditable = { general: false, notes: true };
      this.userEditable = true;
      if (role == "admin") {
        this.orgEditable = { general: true, notes: true };
      } else if (role != "agent") {
        this.countedAjax('getCustomRoles');
      }
    },

    // EVENTS ==================================================================

    init: function() {
      var defaultStorage = {
        user: null,
        ticketsCounters: {},
        orgTicketsCounters: {},
        requestsCount: 0,
        fields: [],
        selectedKeys: [],
        orgFieldsActivated: false,
        tickets: []
      };
      this.storage = _.clone(defaultStorage); // not sure the clone is needed here
      this.storage.orgFieldsActivated = (this.setting('orgFieldsActivated') == 'true');
      var defaultSelection = '["##builtin_tags", "##builtin_details", "##builtin_notes"]';
      this.storage.selectedKeys = JSON.parse(this.setting('selectedFields') || defaultSelection);
      var defaultOrgSelection = '[]';
      this.storage.selectedOrgKeys = JSON.parse(this.setting('orgFields') || defaultOrgSelection);
      if (!this.locale) {
        this.locale = this.currentUser().locale();
      }
      this.setEditable();
      if (this.ticket().requester()) {
        this.requesterEmail = this.ticket().requester().email();
        this.countedAjax('getUser', this.ticket().requester().id());
        this.countedAjax('getUserFields');
        this.countedAjax('getOrganizationFields');
        if (!this.storage.locales) {
          this.countedAjax('getLocales');
        }
      } else {
        this.switchTo('empty');
      }
    },

    onRequesterEmailChanged: function(event, email) {
      if (email && this.requesterEmail != email) {
        this.init();
      }
    },

    onRequestsFinished: function() {
      if (!this.storage.user) return;
      var ticketsCounters = this.storage.ticketsCounters;
      _.each(['new', 'open', 'hold', 'pending', 'solved', 'closed'], function(key) {
        if (!ticketsCounters[key]) {
          ticketsCounters[key] = '-';
        }
      });
      ticketsCounters = this.storage.orgTicketsCounters;
      _.each(['new', 'open', 'hold', 'pending', 'solved', 'closed'], function(key) {
        if (!ticketsCounters[key]) {
          ticketsCounters[key] = '-';
        }
      });
      this.showDisplay();
    },

    onClickExpandBar: function(event, immediate) {
      var additional = this.$('.more-info');
      var expandBar = this.$('.expand-bar i');
      expandBar.attr('class', 'arrow');
      var visible = additional.is(':visible');
      if (immediate) {
        additional.toggle(!visible);
      }
      else {
        additional.slideToggle(!visible);
        this.store('expanded', !visible);
      }
      expandBar.addClass(visible ? 'arrow-down' : 'arrow-up');
    },

    onCogClick: function() {
      var html = this.renderTemplate('admin', {
        fields: this.storage.fields,
        orgFields: this.storage.organizationFields,
        orgFieldsActivated: this.storage.orgFieldsActivated
      });
      this.$('.admin').html(html).show();
      this.$('.whole').hide();
    },

    onBackClick: function() {
      this.$('.admin').hide();
      this.$('.whole').show();
    },

    onSaveClick: function() {
      var that = this;
      var keys = this.$('.fields-list input:checked').map(function() { return that.$(this).val(); });
      var orgKeys = this.$('.org-fields-list input:checked').map(function() { return that.$(this).val(); });
      this.$('input, button').prop('disabled', true);
      this.$('.save').hide();
      this.$('.wait-spin').show();
      this.ajax('saveSelectedFields', keys, orgKeys)
        .always(this.init.bind(this));
    },

    onNotesOrDetailsChanged: _.debounce(function(e) {
      var $textarea    = this.$(e.currentTarget),
          $textareas   = $textarea.parent().siblings('[data-editable=true]').andSelf().find('textarea'),
          type         = $textarea.data('fieldType'),
          typeSingular = type.slice(0, -1),
          data         = {},
          id           = type === 'organizations' ? this.storage.organization.id : this.ticket().requester().id();

      // Build the data object, with the valid resource name and data
      data[typeSingular] = {};
      $textareas.each(function(index, element) {
        var $element  = this.$(element),
            fieldName = $element.data('fieldName');

        data[typeSingular][fieldName] = $element.val();
      }.bind(this));

      // Execute request
      this.ajax('updateNotesOrDetails', type, id, data).then(function() {
        services.notify(this.I18n.t('update_' + typeSingular + '_done'));
      }.bind(this));
    }, 1000),

    onActivateOrgFieldsChange: function(event) {
      var activate = this.$(event.target).is(':checked');
      this.storage.orgFieldsActivated = activate;
      this.$('.org-fields-list').toggle(activate);
    },

    // REQUESTS ================================================================

    onGetCustomRolesDone: function(data) {
      var roles = data.custom_roles;
      var role = _.find(roles, function(role) {
        return role.id == this.currentUser().role();
      }, this);
      this.orgEditable.general = role.configuration.organization_editing;
      this.orgEditable.notes = role.configuration.organization_notes_editing;
      this.userEditable = role.configuration.end_user_profile_access == "full";
      _.each(this.storage.organizationFields, function(field) {
        if (field.key === '##builtin_tags') {
          return;
        } else if (field.key === '##builtin_notes') {
          field.editable = this.orgEditable.notes;
        } else {
          field.editable = this.orgEditable.general;
        }
      }, this);
    },

    onGetLocalesDone: function(data) {
      var locales = {};
      _.each(data.locales, function(obj) {
        locales[obj.locale] = obj.name;
      });
      this.storage.locales = locales;
    },

    onGetUserDone: function(data) {
      this.storage.user = data.user;
      var social = _.filter(data.identities, function(ident) {
        return _.contains(['twitter', 'facebook'], ident.type);
      });
      this.storage.user.identities = _.map(social, function(ident) {
        if (ident.type === 'twitter') {
          ident.value = helpers.fmt('https://twitter.com/%@', ident.value);
        } else if (ident.type === 'facebook') {
          ident.value = helpers.fmt('https://facebook.com/%@', ident.value);
        }
        return ident;
      });
      this.storage.user.organization = data.organizations[0];
      var ticketOrg = this.ticket().organization();
      if (ticketOrg) {
        this.storage.user.organization = _.find(data.organizations, function(org) {
          return org.id === ticketOrg.id();
        });
      }
      this.countedAjax('getOrganizationFields');
      if (data.user && data.user.id) {
        this.countedAjax('getTickets', this.storage.user.id);
      }
      if (data.user.organization) {
        this.storage.organization = {
          id: data.user.organization.id
        };
        this.countedAjax('getOrganizationTickets', this.storage.organization.id);
      }

      if (this.ticket().id()) {
        this.ajax('getTicketAudits', this.ticket().id());
      }
    },

    getTicketAuditsDone: function(data){
      _.each(data.audits, function(audit){
        _.each(audit.events, function(e){
          if (this.auditEventIsSpoke(e)){
            var spokeData = this.spokeData(e);

            if (spokeData){
              this.storage.spokeData = spokeData;
              this.storage.user.email = spokeData.email;
              this.displaySpoke();
            }
          }
        }, this);
      }, this);
    },

    displaySpoke: function() {
      var html = this.renderTemplate('spoke', this.storage.spokeData);
      this.$('.spoke').html(html);
    },

    auditEventIsSpoke: function(event){
      return event.type === 'Comment' &&
        /spoke_id_/.test(event.body);
    },

    spokeData: function(event){
      var data = /spoke_id_(.*) *\n *spoke_account_(.*) *\n *requester_email_(.*) *\n *requester_phone_(.*)/.exec(event.body);

      if (_.isEmpty(data))
        return false;

      return {
        id: data[1].trim(),
        account: data[2].trim(),
        email: data[3].trim(),
        phone: data[4].trim()
      };
    },

    onSearchTicketsDone: function(data) {
      var status = this.TICKET_STATUSES[this.ticketSearchStatus];
      this.storage.ticketsCounters = this.storage.ticketsCounters || {};
      this.storage.ticketsCounters[status] = data.count;
      if (this.ticketSearchStatus === this.TICKET_STATUSES.length - 1) {
        return;
      }
      this.countedAjax('searchTickets', this.storage.user.id, this.TICKET_STATUSES[++this.ticketSearchStatus]);
    },

    onGetTicketsDone: function(data) {
      this.storage.tickets.push.apply(this.storage.tickets, data.tickets);
      if (data.next_page) {
        // determine if it is fewer API hits to search or to continue loading all the tickets
        if (data.count / data.tickets.length - 1 > this.TICKET_STATUSES.length) {
          this.ticketSearchStatus = 0;
          this.countedAjax('searchTickets', this.storage.user.id, this.TICKET_STATUSES[this.ticketSearchStatus]);
          return;
        }
        var pageNumber = data.next_page.match(/page=(\d+)/)[1];
        this.countedAjax('getTickets', this.storage.user.id, pageNumber);
      }
      else {
        var grouped = _.groupBy(this.storage.tickets, 'status');
        var res = this.toObject(_.map(grouped, function(value, key) {
          return [key, value.length];
        }));
        this.storage.ticketsCounters = res;
      }
    },

    onGetOrganizationTicketsDone: function(data) {
      var grouped = _.groupBy(data.tickets, 'status');
      var res = this.toObject(_.map(grouped, function(value, key) {
        return [key, value.length];
      }));
      this.storage.orgTicketsCounters = res;
    },

    onGetOrganizationFieldsDone: function(data) {
      var selectedFields = this.storage.selectedOrgKeys;
      var fields = [
        {
          key: '##builtin_tags',
          title: this.I18n.t('tags'),
          description: '',
          position: 0,
          active: true
        },
        {
          key: '##builtin_details',
          title: this.I18n.t('details'),
          description: '',
          position: Number.MAX_SAFE_INTEGER - 1,
          active: true,
          editable: this.orgEditable.general
        },
        {
          key: '##builtin_notes',
          title: this.I18n.t('notes'),
          description: '',
          position: Number.MAX_SAFE_INTEGER,
          active: true,
          editable: this.orgEditable.notes
        }
      ].concat(data.organization_fields);
      var activeFields = _.filter(fields, function(field) {
        return field.active;
      });
      var restrictedFields = _.map(activeFields, function(field) {
        return {
          key: field.key,
          title: field.title,
          description: field.description,
          position: field.position,
          selected: _.contains(selectedFields, field.key),
          editable: field.editable,
          type: field.type
        };
      });
      this.storage.organizationFields = _.sortBy(restrictedFields, 'position');
    },

    onGetUserFieldsDone: function(data) {
      var selectedFields = this.storage.selectedKeys;
      var fields = [
        {
          key: '##builtin_tags',
          title: this.I18n.t('tags'),
          description: '',
          position: 0,
          active: true
        },
        {
          key: '##builtin_locale',
          title: this.I18n.t('locale'),
          description: '',
          position: 1,
          active: true
        },
        {
          key: '##builtin_details',
          title: this.I18n.t('details'),
          description: '',
          position: Number.MAX_SAFE_INTEGER - 1,
          active: true,
          editable: this.userEditable
        },
        {
          key: '##builtin_notes',
          title: this.I18n.t('notes'),
          description: '',
          position: Number.MAX_SAFE_INTEGER,
          active: true,
          editable: this.userEditable
        }
      ].concat(data.user_fields);
      var activeFields = _.filter(fields, function(field) {
        return field.active;
      });
      var restrictedFields = _.map(activeFields, function(field) {
        return {
          key: field.key,
          title: field.title,
          description: field.description,
          position: field.position,
          selected: _.contains(selectedFields, field.key),
          editable: field.editable,
          type: field.type
        };
      });
      this.storage.fields = _.sortBy(restrictedFields, 'position');
    }
  };
}());
;
}
var app = ZendeskApps.defineApp(source)
  .reopenClass({"location":{"zendesk":{"ticket_sidebar":"_legacy","new_ticket_sidebar":"_legacy"}},"noTemplate":false,"singleInstall":true,"signedUrls":false})
  .reopen({
    appName: "User Data",
    appVersion: "1.0.13",
    assetUrlPrefix: "/api/v2/apps/6536/assets/",
    appClassName: "app-6536",
    author: {
      name: "Zendesk",
      email: "support@zendesk.com"
    },
    translations: {"app":{"parameters":{"unfolded_on_startup":{"label":"Apps tray opened by default"}}},"admin":{"title":"User Data Admin panel","save":"Save and go back","text":"Please select the user fields you would like to permanently display on the App","include_org_fields":"Display organization information"},"info":{"no_tags":"No tags","no_domain_names":"No domain names"},"update_organization_done":"Organization notes and details updated","update_user_done":"User notes and details updated.","ajax_error":"An error occurred. Please try again later.","tickets":"Tickets","toggle_details_notes":"Toggle Details and Notes","toggle_organization":"Toggle organization","details_and_notes":"Details and Notes","details":"Details","notes":"Notes","locale":"User's language","tags":"Tags","organization":"Organization","ticket_status":{"new":"n","open":"o","pending":"p","hold":"h","solved":"s","closed":"c"},"spoke-ticket":{"link":{"pre":"This ticket is from the spoke account:"}},"account":"Account","spoke_ticket_id":"Spoke Ticket ID"},
    templates: {"admin":"\u003ca class=\"back\"\u003e\u003ci class=\"icon-circle-arrow-left\"/\u003e\u003c/a\u003e\n\u003ch4\u003e{{t \"admin.title\"}}\u003c/h4\u003e\n\u003cp\u003e{{t \"admin.text\"}}\u003c/p\u003e\n\n\u003cul class=\"fields-list\"\u003e\n  {{#each fields}}\n    \u003cli\u003e\n      \u003cinput type=\"checkbox\" value=\"{{key}}\" id=\"{{key}}\" {{#if selected}}checked{{/if}}/\u003e\n      \u003clabel for=\"{{key}}\"\u003e{{title}}\u003c/label\u003e\n    \u003c/li\u003e\n  {{/each}}\n\u003c/ul\u003e\n\n{{#if orgFields.length }}\n  \u003cdiv class=\"org-fields\"\u003e\n    \u003clabel class=\"checkbox\"\u003e\n      \u003cinput type=\"checkbox\" class=\"org-fields-activate\" {{#if orgFieldsActivated}}checked{{/if}}\u003e\n      {{t \"admin.include_org_fields\"}}\n    \u003c/label\u003e\n\n    \u003cul class=\"org-fields-list\" {{#unless orgFieldsActivated}}style=\"display: none\"{{/unless}}\u003e\n      {{#each orgFields}}\n        \u003cli\u003e\n          \u003clabel class=\"checkbox\"\u003e\n            \u003cinput type=\"checkbox\" value=\"{{key}}\" {{#if selected}}checked{{/if}}\u003e\n            {{title}}\n          \u003c/label\u003e\n        \u003c/li\u003e\n      {{/each}}\n    \u003c/ul\u003e\n  \u003c/div\u003e\n{{/if}}\n\n\u003cbutton class=\"btn save\"\u003e{{t \"admin.save\"}}\u003c/button\u003e\n\u003cdiv class=\"wait-spin hide\"\u003e{{spinner}}\u003c/div\u003e","display":"\u003cdiv class=\"admin\" style=\"display: none\"\u003e\u003c/div\u003e\n\n\u003cdiv class=\"whole\"\u003e\n  \u003cdiv class=\"card\"\u003e\n    \u003cdiv class=\"row-fluid\"\u003e\n      {{#if isAdmin}}\n        \u003ca class=\"cog\"\u003e\u003c/a\u003e\n      {{/if}}\n\n      \u003cdiv class=\"spoke\"\u003e\u003c/div\u003e\n\n      {{#if user.photo}}\n        \u003cdiv class=\"avatar\"\u003e\u003cimg src=\"{{user.photo.content_url}}\"/\u003e\u003c/div\u003e\n      {{else}}\n        \u003cdiv class=\"avatar default\"\u003e\u003c/div\u003e\n      {{/if}}\n\n      {{#if user.identities.length}}\n        \u003cdiv class=\"social pull-right\"\u003e\n          {{#each user.identities}}\n            \u003ca href=\"{{value}}\" target=\"_blank\" class=\"{{type}}\"\u003e\u003c/a\u003e\n          {{/each}}\n        \u003c/div\u003e\n      {{/if}}\n\n      \u003cdiv class=\"contacts\"\u003e\n        \u003cdiv class=\"name\"\u003e\u003ca href=\"#/tickets/{{ticketId}}/requester/tickets\"\u003e{{user.name}}\u003c/a\u003e\u003c/div\u003e\n        \u003cdiv class=\"email\"\u003e{{user.email}}\u003c/div\u003e\n        \u003cdiv class=\"phone\"\u003e{{user.phone}}\u003c/div\u003e\n        {{#if user.organization}}\n          \u003cdiv class=\"organization\"\u003e\n            \u003ca href=\"#/tickets/{{ticketId}}/organization/tickets\"\u003e{{user.organization.name}}\u003c/a\u003e\n          \u003c/div\u003e\n        {{/if}}\n      \u003c/div\u003e\n    \u003c/div\u003e\n\n    \u003cdiv class=\"row-fluid\"\u003e\n      \u003cul class=\"counts\"\u003e\n        \u003cli\u003e\n          \u003cspan class=\"ticket_status_label new\"\u003e{{t \"ticket_status.new\"}}\u003c/span\u003e\n          \u003cspan class=\"count new\"\u003e{{{tickets.new}}}\u003c/span\u003e\n        \u003c/li\u003e\n        \u003cli\u003e\n          \u003cspan class=\"ticket_status_label open\"\u003e{{t \"ticket_status.open\"}}\u003c/span\u003e\n          \u003cspan class=\"count open\"\u003e{{{tickets.open}}}\u003c/span\u003e\n        \u003c/li\u003e\n        \u003cli\u003e\n          \u003cspan class=\"ticket_status_label solved\"\u003e{{t \"ticket_status.solved\"}}\u003c/span\u003e\n          \u003cspan class=\"count solved\"\u003e{{{tickets.solved}}}\u003c/span\u003e\n        \u003c/li\u003e\n        \u003cli\u003e\n          \u003cspan class=\"ticket_status_label pending\"\u003e{{t \"ticket_status.pending\"}}\u003c/span\u003e\n          \u003cspan class=\"count pending\"\u003e{{{tickets.pending}}}\u003c/span\u003e\n        \u003c/li\u003e\n        \u003cli\u003e\n          \u003cspan class=\"ticket_status_label hold\"\u003e{{t \"ticket_status.hold\"}}\u003c/span\u003e\n          \u003cspan class=\"count hold\"\u003e{{{tickets.hold}}}\u003c/span\u003e\n        \u003c/li\u003e\n        \u003cli\u003e\n          \u003cspan class=\"ticket_status_label closed\"\u003e{{t \"ticket_status.closed\"}}\u003c/span\u003e\n          \u003cspan class=\"count closed\"\u003e{{{tickets.closed}}}\u003c/span\u003e\n        \u003c/li\u003e\n      \u003c/ul\u003e\n    \u003c/div\u003e\n  \u003c/div\u003e\n\n  \u003cdiv class=\"more-info hide\"\u003e\n    \u003cdiv class=\"additional\"\u003e\n      {{#each fields}}\n        \u003cdiv class=\"field {{simpleKey}}\" key=\"{{key}}\" data-editable=\"{{editable}}\"\u003e\n          \u003ch4\u003e{{title}}\u003c/h4\u003e\n          {{#if editable}}\n            \u003ctextarea class=\"notes-or-details\" data-field-name=\"{{name}}\" data-field-type=\"users\"\u003e{{value}}\u003c/textarea\u003e\n          {{else}}\n            \u003cp\u003e{{#if html}}{{{value}}}{{else}}{{value}}{{/if}}\u003c/p\u003e\n          {{/if}}\n        \u003c/div\u003e\n      {{/each}}\n    \u003c/div\u003e\n\n    \u003c!--  Organization --\u003e\n    {{#if orgFieldsActivated}}\n      \u003cdiv class=\"card org\"\u003e\n        \u003cdiv class=\"row-fluid\"\u003e\n          {{#if org.photo}}\n            \u003cdiv class=\"avatar\"\u003e\u003cimg src=\"{{user.photo.content_url}}\"/\u003e\u003c/div\u003e\n          {{else}}\n            \u003cdiv class=\"avatar org default\"\u003e\u003c/div\u003e\n          {{/if}}\n\n          \u003cdiv class=\"contacts\"\u003e\n            \u003cdiv class=\"name\"\u003e\u003ca href=\"#/tickets/{{ticketId}}/organization/tickets\"\u003e{{org.name}}\u003c/a\u003e\u003c/div\u003e\n            \u003cdiv class=\"email\"\u003e{{org.email}}\u003c/div\u003e\n          \u003c/div\u003e\n        \u003c/div\u003e\n\n        \u003cdiv class=\"row-fluid\"\u003e\n          \u003cul class=\"counts\"\u003e\n            \u003cli\u003e\n              \u003cspan class=\"ticket_status_label new\"\u003e{{t \"ticket_status.new\"}}\u003c/span\u003e\n              \u003cspan class=\"count new\"\u003e{{{orgTickets.new}}}\u003c/span\u003e\n            \u003c/li\u003e\n            \u003cli\u003e\n              \u003cspan class=\"ticket_status_label open\"\u003e{{t \"ticket_status.open\"}}\u003c/span\u003e\n              \u003cspan class=\"count open\"\u003e{{{orgTickets.open}}}\u003c/span\u003e\n            \u003c/li\u003e\n            \u003cli\u003e\n              \u003cspan class=\"ticket_status_label solved\"\u003e{{t \"ticket_status.solved\"}}\u003c/span\u003e\n              \u003cspan class=\"count solved\"\u003e{{{orgTickets.solved}}}\u003c/span\u003e\n            \u003c/li\u003e\n            \u003cli\u003e\n              \u003cspan class=\"ticket_status_label pending\"\u003e{{t \"ticket_status.pending\"}}\u003c/span\u003e\n              \u003cspan class=\"count pending\"\u003e{{{orgTickets.pending}}}\u003c/span\u003e\n            \u003c/li\u003e\n            \u003cli\u003e\n              \u003cspan class=\"ticket_status_label hold\"\u003e{{t \"ticket_status.hold\"}}\u003c/span\u003e\n              \u003cspan class=\"count hold\"\u003e{{{orgTickets.hold}}}\u003c/span\u003e\n            \u003c/li\u003e\n            \u003cli\u003e\n              \u003cspan class=\"ticket_status_label closed\"\u003e{{t \"ticket_status.closed\"}}\u003c/span\u003e\n              \u003cspan class=\"count closed\"\u003e{{{orgTickets.closed}}}\u003c/span\u003e\n            \u003c/li\u003e\n          \u003c/ul\u003e\n        \u003c/div\u003e\n      \u003c/div\u003e\n\n      \u003cdiv class=\"additional\"\u003e\n        {{#each orgFields}}\n          \u003cdiv class=\"field {{simpleKey}}\" key=\"{{key}}\" data-editable=\"{{editable}}\"\u003e\n            \u003ch4\u003e{{title}}\u003c/h4\u003e\n            {{#if editable}}\n              \u003ctextarea class=\"notes-or-details\" data-field-name=\"{{name}}\" data-field-type=\"organizations\"\u003e{{value}}\u003c/textarea\u003e\n            {{else}}\n              \u003cp\u003e{{#if html}}{{{value}}}{{else}}{{value}}{{/if}}\u003c/p\u003e\n            {{/if}}\n          \u003c/div\u003e\n        {{/each}}\n      \u003c/div\u003e\n    {{/if}}\n    \u003c!-- end org --\u003e\n  \u003c/div\u003e\n\n  \u003ca class=\"expand-bar\"\u003e\u003ci class=\"arrow arrow-down\"/\u003e\u003c/a\u003e\n\u003c/div\u003e","empty":"{{spinner}}","layout":"\u003cstyle\u003e\n.app-6536 header .logo {\n  background-image: url(\"/api/v2/apps/6536/assets/logo-small.png\"); }\n.app-6536.box.apps_ticket_sidebar.app_view {\n  padding-bottom: 0px;\n  padding-top: 15px;\n  color: #333; }\n.app-6536 .admin {\n  margin-bottom: 15px; }\n  .app-6536 .admin p {\n    color: #999;\n    margin-top: 1em;\n    margin-bottom: 1em; }\n  .app-6536 .admin .fields-list label {\n    display: inline; }\n  .app-6536 .admin .org-fields {\n    margin-top: 15px; }\n  .app-6536 .admin .back {\n    display: block;\n    float: right;\n    opacity: 0.5;\n    margin-top: 3px; }\n  .app-6536 .admin .save {\n    display: block;\n    margin-top: 20px;\n    margin-left: auto;\n    margin-right: auto;\n    padding-left: 20px;\n    padding-right: 20px; }\n.app-6536 .whole {\n  -webkit-transition: all 0.5s;\n  transition: all 0.5s;\n  background: #fff; }\n  .app-6536 .whole .hide {\n    display: none; }\n  .app-6536 .whole .additional {\n    padding-left: auto;\n    padding-right: auto; }\n    .app-6536 .whole .additional .field {\n      margin-top: 15px;\n      border-top: 1px solid #f0f0f0;\n      padding-top: 10px; }\n      .app-6536 .whole .additional .field textarea {\n        box-shadow: white 0px 0px 0px 0px inset;\n        padding: 0px;\n        width: 100%;\n        height: 72px;\n        box-sizing: border-box;\n        border: 0px;\n        font-size: 14px; }\n      .app-6536 .whole .additional .field.builtin.tags ul {\n        margin-left: -3px; }\n      .app-6536 .whole .additional .field.builtin.tags h4, .app-6536 .whole .additional .field.builtin.tags p {\n        margin-top: 2px; }\n      .app-6536 .whole .additional .field.builtin.tags hr {\n        clear: both;\n        border: 0px;\n        margin-bottom: 0px; }\n      .app-6536 .whole .additional .field.builtin.tags li {\n        float: left;\n        margin-left: 3px;\n        margin-right: 3px;\n        padding: 3px 6px 4px 6px;\n        font-size: 11px;\n        line-height: 13px;\n        display: block;\n        background: #f4f4f4;\n        color: #333;\n        min-height: 13px;\n        border-radius: 3px;\n        border: 1px solid #ddd;\n        word-break: break-all;\n        white-space: pre-wrap;\n        white-space: -moz-pre-wrap;\n        word-wrap: break-word;\n        -ms-word-break: break-all; }\n      .app-6536 .whole .additional .field h4 {\n        font-size: 14px;\n        color: #999;\n        font-weight: normal;\n        margin-bottom: 10px; }\n      .app-6536 .whole .additional .field p {\n        font-size: 14px;\n        color: #555;\n        line-height: 1.4; }\n  .app-6536 .whole .card.org {\n    border-top: 1px solid #f0f0f0;\n    padding-top: 15px;\n    margin-top: 15px; }\n  .app-6536 .whole .card .cog {\n    float: right;\n    position: relative;\n    top: 0px;\n    left: 0px;\n    width: 12px;\n    height: 12px;\n    display: inline-block;\n    background-image: url(\"/api/v2/apps/6536/assets/ico-settings-normal.png\"); }\n    .app-6536 .whole .card .cog:hover {\n      background-image: url(\"/api/v2/apps/6536/assets/ico-settings-hover.png\"); }\n  .app-6536 .whole .card .social {\n    float: right;\n    margin-top: 23px;\n    left: 12px; }\n    .app-6536 .whole .card .social a {\n      display: block;\n      background-image: url(\"/api/v2/apps/6536/assets/ico-social-sprite.png\"); }\n      .app-6536 .whole .card .social a.facebook {\n        width: 5px;\n        height: 10px; }\n        .app-6536 .whole .card .social a.facebook:hover {\n          background-position: 0px -11px; }\n      .app-6536 .whole .card .social a.twitter {\n        width: 11px;\n        height: 10px;\n        background-position: -6px 0px; }\n        .app-6536 .whole .card .social a.twitter:hover {\n          background-position: -6px -11px; }\n  .app-6536 .whole .card .avatar {\n    width: 50px;\n    height: 50px;\n    float: left; }\n    .app-6536 .whole .card .avatar.default {\n      background-image: url(\"/api/v2/apps/6536/assets/avatar.png\");\n      background-size: cover;\n      border-radius: 50px; }\n      .app-6536 .whole .card .avatar.default.org {\n        background-image: url(\"/api/v2/apps/6536/assets/org.png\"); }\n    .app-6536 .whole .card .avatar img {\n      border-radius: 50px; }\n  .app-6536 .whole .card .contacts {\n    margin-left: 65px; }\n    .app-6536 .whole .card .contacts div {\n      color: #999;\n      font-size: 14px;\n      word-wrap: break-word; }\n      .app-6536 .whole .card .contacts div.name {\n        font-size: 16px;\n        font-weight: 600; }\n        .app-6536 .whole .card .contacts div.name a {\n          color: #555; }\n      .app-6536 .whole .card .contacts div.organization a {\n        color: #999; }\n      .app-6536 .whole .card .contacts div.name a:hover, .app-6536 .whole .card .contacts div.organization a:hover {\n        color: #146eaa; }\n  .app-6536 .whole .card .counts {\n    margin: 0px;\n    margin-top: 30px; }\n    .app-6536 .whole .card .counts li {\n      display: inline-block;\n      font-size: 12px;\n      color: #999;\n      width: 50px;\n      line-height: 1.486; }\n      .app-6536 .whole .card .counts li a {\n        color: #999;\n        position: relative;\n        top: 2px; }\n      .app-6536 .whole .card .counts li .ticket_status_label {\n        font-size: 10px;\n        line-height: 14px;\n        padding: 0;\n        padding-left: 4px;\n        padding-right: 4px;\n        height: 15px;\n        display: inline-block;\n        vertical-align: middle;\n        box-sizing: border-box;\n        white-space: nowrap;\n        text-align: center;\n        opacity: 0.6;\n        width: 15px; }\n  .app-6536 .whole .expand-bar {\n    background-color: #fff;\n    border-top: 1px solid #f0f0f0;\n    padding-top: 0px;\n    padding-bottom: 15px;\n    display: block;\n    margin-top: 30px; }\n    .app-6536 .whole .expand-bar .arrow {\n      margin-top: 12px;\n      height: 6px;\n      min-width: 11px;\n      display: block;\n      background-repeat: no-repeat;\n      background-position: center; }\n      .app-6536 .whole .expand-bar .arrow.arrow-down {\n        background-image: url(\"/api/v2/apps/6536/assets/ico-arrow-down-normal.png\"); }\n        .app-6536 .whole .expand-bar .arrow.arrow-down:hover {\n          background-image: url(\"/api/v2/apps/6536/assets/ico-arrow-down-hover.png\"); }\n      .app-6536 .whole .expand-bar .arrow.arrow-up {\n        background-image: url(\"/api/v2/apps/6536/assets/ico-arrow-up-normal.png\"); }\n        .app-6536 .whole .expand-bar .arrow.arrow-up:hover {\n          background-image: url(\"/api/v2/apps/6536/assets/ico-arrow-up-hover.png\"); }\n    .app-6536 .whole .expand-bar:hover {\n      background-image: url(\"/api/v2/apps/6536/assets/hover-bg.png\");\n      background-repeat: no-repeat;\n      background-position: center top; }\n    .app-6536 .whole .expand-bar span {\n      display: block;\n      margin-left: auto;\n      margin-right: auto;\n      opacity: 0.4; }\n\u003c/style\u003e\n\u003cdiv data-main\u003e\n  {{spinner}}\n\u003c/div\u003e","spoke":"\u003cdiv class=\"well well-small alert\"\u003e\n  \u003cstrong\u003e\n    {{t \"spoke-ticket.link.pre\"}}\n    \u003ca href=\"https://{{account}}.zendesk.com\"\u003e{{account}}\u003c/a\u003e\n    \u003cbr/\u003e\n    {{t \"spoke_ticket_id\"}}:\n    \u003ca href=\"https://{{account}}.zendesk.com/tickets/{{id}}\"\u003e{{id}}\u003c/a\u003e\n  \u003c/strong\u003e\n\u003c/div\u003e","tags":"\u003cul\u003e\n  {{#each tags}}\n    \u003cli\u003e{{this}}\u003c/li\u003e\n  {{/each}}\n\u003c/ul\u003e\n\u003chr\u003e"},
    frameworkVersion: "1.0"
  });

ZendeskApps["User Data"] = app;

    with( ZendeskApps.AppScope.create() ) {

  var source = (function() {
  return {
    current_user: null,
    requests: {
      fetchCurrentUser: function(){
        return {
          url: '/api/v2/users/' + this.currentUser().id() + '.json?include=groups,organizations',
          method: 'GET',
          //proxy_v2: true
        };
      }
    },
    events: {
      'app.activated': function(app){
        if (app.firstLoad) { return this.ajax('fetchCurrentUser'); }
      },
      'fetchCurrentUser.done': 'initialize'
    },

    initialize: function(data) {
      this.current_user = _.extend(data, data.user);

      if (this.currentUserIsTarget())
        return this.hideAssigneeOptions();
    },

    currentUserIsTarget: function(){
      var rules = [
        [ 'targeted_user_ids', String(this.current_user.id) ],
        [ 'targeted_user_tags', this.current_user.tags ],
        [ 'targeted_organization_ids', _.map(this.current_user.organizations, function(org) { return String(org.id); })],
        [ 'targeted_group_ids', _.map(this.current_user.groups, function(group) { return String(group.id); })]
      ];

      return _.any(_.map(
        rules,
        function(rule){
          return this._contains(this._settings(rule[0]), rule[1]);
        },
        this
      ));
    },

    hideAssigneeOptions: function(){
      var group_ids = this._settings('hidden_group_ids');
      var user_ids = this._settings('hidden_user_ids');

      _.each(this.ticketFields('assignee').options(), function(option){
        var group_and_user = option.value().split(':'),
        group_id = group_and_user[0],
        user_id = group_and_user[1] || "";

        if (_.contains(group_ids, group_id) ||
            _.contains(user_ids, user_id)){
          option.hide();
        }
      });
    },

    _settings: function(label){
      return _.compact((this.setting(label) || "").split(','));
    },

    _contains: function(list, values){
      if (typeof values !== "object")
        return _.contains(list, values);

      var flattened_contains = _.inject(values, function(memo, value){
        memo.push(_.contains(list, value));
        return memo;
      }, []);

      return _.any(flattened_contains);
    }
  };

}());
;

  var app = ZendeskApps.defineApp(source)
    .reopenClass({"location":["ticket_sidebar","new_ticket_sidebar"],"noTemplate":false,"singleInstall":false})
    .reopen({
      appName: "Assignment Control",
      appVersion: null,
      assetUrlPrefix: "/api/v2/apps/52174/assets/",
      appClassName: "app-52174",
      author: {
        name: "Zendesk Labs",
        email: "zendesklabs@zendesk.com"
      },
      translations: {"app":{"parameters":{"hidden_user_ids":{"label":"Hidden Users","helpText":"A comma separated list of user ids."},"hidden_group_ids":{"label":"Hiden Groups","helpText":"A comma separated list of group ids."},"targeted_user_ids":{"label":"Targeted Users","helpText":"A comma separated list of user ids."},"targeted_user_tags":{"label":"Targeted User Tags","helpText":"A comma separated list of user tags."},"targeted_organization_ids":{"label":"Targeted Organizations","helpText":"A comma separated list of organization ids."},"targeted_group_ids":{"label":"Targeted Groups","helpText":"A comma separated list of group ids."}}}},
      templates: {"layout":"\u003cstyle\u003e\n.app-52174 header .logo {\n  background-image: url(\"/api/v2/apps/52174/assets/logo-small.png\"); }\n\u003c/style\u003e\n"},
      frameworkVersion: "1.0"
    });

  ZendeskApps["Assignment Control"] = app;
}

    with( ZendeskApps.AppScope.create() ) {

  var source = /*global Blob*/
/*global URL*/
/*global File*/

(function() {
  return {
    // EVENTS =================================================================================================================
    events: {
      'app.activated':'onAppActivated',
      'pane.activated':'onPaneActivated',
      'change select.type':'onTypeChanged',
      'keyup input.user':'findUsers',
      // 'keyup input.string':'onTextEntered',
      // 'change select.dateType':'onDateTypeChanged',
      // 'change input.startDate':'onStartDateChanged',
      // 'change input.endDate':'onEndDateChanged',
      // 'change select.group':'onGroupChanged',
      // 'change select.assignee':'onAssigneeChanged',
      'click button.addFilter':'onAddFilterClicked',
      'click button.search':'onSearchClicked',
      'click a.prev_page':'onPrevClicked',
      'click a.next_page':'onNextClicked',

      // request events
      'search.done':'onSearchComplete',
      // 'search.fail':'onSearchFail',
      'getUrl.done':'onSearchComplete',
      'getTicketFields.done':'setCustomFields'
    },

    // REQUESTS =================================================================================================================
    requests: {
      // searchIncremental: function(query, sort_by, sort_order, page) {
      //   return {
      //     url: helpers.fmt('/api/v2/search/incremental?query=%@&sort_by=%@&sort_order=%@&page=%@', query, sort_by, sort_order, page)
      //   };
      // },

      autocompleteUsers: function(name) {
        return {
          url: '/api/v2/users/autocomplete.json?name=' + name
        };
      },

      search: function(query, sort_by, sort_order, page) {
        return {
          url: helpers.fmt('/api/v2/search.json?query=%@&sort_by=%@&sort_order=%@&page=%@', query, sort_by, sort_order, page)
        };
      },

      getUrl: function(url) {
        return {
          url: url
        };
      },

      getAssignees: function(page) {
        return {
          url: helpers.fmt('/api/v2/users.json?role[]=agent&role[]=admin&page=%@', page)
        };
      },

      getUsersBatch: function(userBatch) {
        var ids = userBatch.toString();
        return {
          url: '/api/v2/users/show_many.json?ids=' + ids
        };
      },

      getTicketFields: function(url) {
        if(!url) {url = '/api/v2/ticket_fields.json';}
        return {
          url: url
        };
      }
    },

    // EVENT CALLBACKS ==========================================================================================================
    onAppActivated: function() {
      if (File && Blob && URL) {
        // Browser is fully supportive for export
        this.exportEnabled = true;
      } else {
        // Browser not supported. Disable export
        this.exportEnabled = false;
      }
    },

    onPaneActivated: function(data) {
      if (data.firstLoad) {
        this.switchTo('main');
        this.$('span.loading').hide();
        this.$('span.no_results').hide();
        this.userIDs = [];
        this.users = [];
        this.ticketFields = [];
        this.customFields = [];
        this.columns = {};
        this.ajax('getTicketFields');
      }
    },

    onTypeChanged: function(e) {
      var type = e.currentTarget.value,
          options_html = '';

      switch (type) {
        case "ticket":
          options_html = this.renderTemplate("ticket_options", {
            customFields: this.customFields
          });
        break;
        case "topic":
          options_html = this.renderTemplate("topic_options");
        break;
        case "user":
          options_html = this.renderTemplate("user_options");
        break;
        case "organization":
          options_html = this.renderTemplate("organization_options");
        break;
        case "":
          options_html = "Choose a specific type to get access to additional filter options.";
        break;
      }
      //inject additional options
      this.$("div.type_options").html(options_html);
      // autocomplete ticket options
      var userFields = ["assignee","requester","submitter","cc","commenter"];
      _.each(userFields, function(title) {
        this.$('input.' + title).autocomplete({
          minLength: 0
        });
      }, this);
    },

    findUsers: function(e) {
      var name = e.currentTarget.value;
      var encodedQuery = encodeURIComponent(name);
      this.ajax('autocompleteUsers', encodedQuery).done(function(response) {
        var users = _.map(response.users, function(user) {
          return {
            label: user.name + " | " + user.email,
            value: user.email || user.id
          };
        });

        this.$('input#' + e.currentTarget.id).autocomplete({
          source: users
        });
      });
    },

    onAddFilterClicked: function(e) {
      if (e) {e.preventDefault();}
      // render various filters
    },


    onSearchClicked: function(e) {
      if (e) {e.preventDefault();}
      this.$('div.results').html('');
      var string = this.$('input.string').val(),
        type = this.$('form.main_search select.type').val();
      this.type = type;
      var filter_string = '';
      switch (type) {
        case "ticket"://if searching for tickets
          var status_operator = '';
          // TODO change to another switch
          if(this.$('form.ticket_filters select.status_operator').val() == 'greater') {
            status_operator = '>';
          } else if (this.$('form.ticket_filters select.status_operator').val() == 'less') {
            status_operator = '<';
          } else if (this.$('form.ticket_filters select.status_operator').val() == ':') {
            status_operator = ':';
          }
          var priority_operator = '';
          if(this.$('form.ticket_filters select.priority_operator').val() == 'greater') {
            priority_operator = '>';
          } else if (this.$('form.ticket_filters select.priority_operator').val() == 'less') {
            priority_operator = '<';
          } else if (this.$('form.ticket_filters select.priority_operator').val() == ':') {
            priority_operator = ':';
          }
          var date_operator = '';
          if(this.$('form.ticket_filters select.date_operator').val() == 'greater') {
            date_operator = '>';
          } else if (this.$('form.ticket_filters select.date_operator').val() == 'less') {
            date_operator = '<';
          } else if (this.$('form.ticket_filters select.date_operator').val() == ':') {
            date_operator = ':';
          }
          var ticket_filters = {
            "status": status_operator + this.$('form.ticket_filters select.status_value').val(),
            "ticket_type": this.$('form.ticket_filters select.ticket_type').val(),
            "priority": priority_operator + this.$('form.ticket_filters select.priority_value').val(),
            "date": this.$('form.ticket_filters select.date_type').val() + date_operator + this.$('form.ticket_filters input.date_value').val(),
            "group": this.$('form.ticket_filters input.group').val(),
            "assignee": this.$('form.ticket_filters input.assignee').val(),
            "submitter": this.$('form.ticket_filters input.submitter').val(),
            "organization": this.$('form.ticket_filters input.organization').val(),
            "requester": this.$('form.ticket_filters input.requester').val(),
            "commenter": this.$('form.ticket_filters input.commenter').val(),
            "cc": this.$('form.ticket_filters input.cc').val(),
            "subject": this.$('form.ticket_filters input.subject').val(),
            "description": this.$('form.ticket_filters input.description').val(),
            "tags": this.$('form.ticket_filters input.tags').val(), //.split(/\W/)
            "via": this.$('form.ticket_filters select.via').val()
          };

          // render a template to build the filters string
          filter_string = this.renderTemplate('ticket_filter_string', {
            filters: ticket_filters
          });

          this.columns = {
            type: this.$('form.ticket_columns .type').prop('checked'),
            id: this.$('form.ticket_columns .id').prop('checked'),
            subject: this.$('form.ticket_columns .subject').prop('checked'),
            group: this.$('form.ticket_columns .group').prop('checked'),
            assignee: this.$('form.ticket_columns .assignee').prop('checked'),
            assignee_email: this.$('form.ticket_columns .assignee_email').prop('checked'),
            requester: this.$('form.ticket_columns .requester').prop('checked'),
            requester_email: this.$('form.ticket_columns .requester_email').prop('checked'),
            status: this.$('form.ticket_columns .status').prop('checked'),
            priority: this.$('form.ticket_columns .priority').prop('checked'),
            created_at: this.$('form.ticket_columns .created').prop('checked'),
            updated_at: this.$('form.ticket_columns .updated').prop('checked'),

            external_id: this.$('form.ticket_columns .external_id').prop('checked'),
            channel:  this.$('form.ticket_columns .channel').prop('checked'),
            description:  this.$('form.ticket_columns .description').prop('checked'),
            recipient: this.$('form.ticket_columns .recipient').prop('checked'),
            submitter: this.$('form.ticket_columns .submitter').prop('checked'),
            submitter_email: this.$('form.ticket_columns .submitter_email').prop('checked'),
            organization: this.$('form.ticket_columns .organization').prop('checked'),
            collaborators: this.$('form.ticket_columns .collaborators').prop('checked'),
            forum_topic: this.$('form.ticket_columns .forum_topic').prop('checked'),
            problem_id: this.$('form.ticket_columns .problem_id').prop('checked'),
            has_incidents: this.$('form.ticket_columns .has_incidents').prop('checked'),
            tags: this.$('form.ticket_columns .tags').prop('checked'),

            customFields: this.selectCustomFields()
          };
        break;
        //  TODO add cases for other objects
      } // end switch
      
      //no matter the type...
      this.results = [];
      var query = string + filter_string + ' type:' + type,
        sort_by = this.$('select.sort_by').val(),
        sort_order = this.$('select.sort_order').val(),
        page = '1';
      if(query.length < 2) {
        services.notify("A search query must have at least two characters.", "error");
      } else {
        var encodedQuery = encodeURIComponent(query);
        // store the query globally
        this.encodedQuery = encodedQuery;
        this.$("span.no_results").hide();
        this.$("span.loading").show();
        // make the request
        this.ajax('search', encodedQuery, sort_by, sort_order, page);
      }
    },

    onPrevClicked: function(e) {
      e.preventDefault();
      this.results = [];
      this.ajax('getUrl', this.prev_page);
      this.$('div.results').html('');
      this.$("span.loading").show();
    },

    onNextClicked: function(e) {
      e.preventDefault();
      this.results = [];
      this.ajax('getUrl', this.next_page);
      this.$('div.results').html('');
      this.$("span.loading").show();
    },

    // onFilterSelected: function(e) {
    //   if (e) {e.preventDefault();}
    //   //grab the selection and render the additional filter UI
    //   //use a global variable to track the number of these filters rendered, and give them an ID to indicate?
    // },

    // REQUEST CALLBACKS ==========================================================================================================
    setCustomFields: function(ticket_fields) {
      this.ticketFields = this.ticketFields.concat(ticket_fields.ticket_fields);

      if (ticket_fields.next_page) {
        this.ajax('getTicketFields', ticket_fields.next_page);
        return;
      } else {
        this.customFields = _.filter(this.ticketFields, function(field) {
          return !_.contains(['subject', 'description', 'status', 'tickettype', 'priority', 'group', 'assignee'], field.type) && field.active;
        });
        var e = {"currentTarget": {"value": "ticket"}};
        this.onTypeChanged(e);
      }
    },

    // findOrgs: function() {

    // },

    // foundOrgs: function(response) {
    //   var organizations = response.organizations;

    // },

    onSearchComplete: function(response) {
      var allPages = this.$('.all_pages').prop('checked');
      this.results = this.results.concat(response.results);
      var next_page,
          prev_page;
      if(allPages && response.next_page) {
        // get the next page by URL
        this.ajax('getUrl', response.next_page);
        return;
      } else {
        // TODO: add buttons # numbering
        if(response.next_page) {
          next_page = response.next_page;
          this.next_page = response.next_page;
        }
        if(response.previous_page) {
          prev_page = response.previous_page;
          this.prev_page = response.previous_page;
        }
        this.numberOfResults = response.count;
      }
      var results = this.results;
      if(results.length === 0) {
        this.$("span.loading").hide();
        this.$('span.no_results').show();
        return;
      }
      // TODO make conditional for results type - e.g. this.type == 'tickets'
      // massage the data...
      _.each(results, function(result, n) {
        // store user IDs
        var last;
        if(results.length == n+1) {last = true;}
        else {last = false;}
        var users = _.union(result.collaborator_ids, [result.assignee_id, result.requester_id, result.submitter_id]);
        this.addUsers(users, last);
      }.bind(this));
    },

    // HELPER METHODS ===========================================================================================================

    addUsers: function(ids, last) {
      _.each(ids, function(id) {
        this.userIDs.push(id);
      }.bind(this));
      this.userIDs = _.filter(_.uniq(this.userIDs), Boolean);
      if(this.userIDs.length >= 100 || last) {
        var userBatch = _.first(this.userIDs, 100);
        this.userIDs = _.rest(this.userIDs, 99);
        this.ajax('getUsersBatch', userBatch).done(function(response) {
          this.users = this.users.concat(response.users);
          _.defer(function(){
            this.encodeResults(this.results);
          }.bind(this));
        });
      }
    },

    selectCustomFields: function() {
      var that = this,
        customFields = this.customFields,
        selected = this.$('.custom_field_options input').map(function () {
          if( that.$(this).prop('checked') ) {
            return that.$(this).attr('data-field-option-id');
          }
        });
      selected = _.toArray(selected);
      var columns = _.filter(customFields, function(cf) {
        return _.contains(selected, cf.id.toString());
      });
      return columns;
    },

    encodeResults: function(results) {
      this.encoded = [];
      var custom_fields = this.columns.customFields;
      var cfIDs = _.map(custom_fields, function(cf) {
        return cf.id;
      });
      _.each(results, function(result, n) {
        // filter the custom field result set down to the selected columns
        result.custom_fields = _.filter(result.custom_fields, function(cf) {
          return _.contains(cfIDs, cf.id);
        });
        result.custom_fields = _.map(result.custom_fields, function(cf) {
          var field = _.find(custom_fields, function(f) { return f.id == cf.id; });
          // add flag to textarea fields (used in the template)
          if(field.type == 'textarea') {
            cf.textarea = true;
          }
          return cf;
        });
        if(result.description) {
          result.description = result.description.replace(/"/g, '\"\"');
        }
        // format dates
        result.created_at = new Date(result.created_at).toLocaleString();
        result.updated_at = new Date(result.updated_at).toLocaleString();
        // look up users from unique array
        var assignee = _.find(this.users, function(user) { return user.id == result.assignee_id; }),
          requester = _.find(this.users, function(user) { return user.id == result.requester_id; }),
          submitter = _.find(this.users, function(user) { return user.id == result.submitter_id; });
        var collaborators = _.map(result.collaborator_ids, function(id) {
          return _.find(this.users, function(user) { return user.id == id; });
        }, this);
        // replace user ids w/ names
        if(assignee) {
          result.assignee = assignee.name;
          result.assignee_email = assignee.email;
        }
        else {
          result.assignee = result.assignee_id;
          result.assignee_email = null;
        }
        if(requester) {
          result.requester = requester.name;
          result.requester_email = requester.email;
        }
        else {
          result.requester = result.requester_id;
          result.requester_email = null;
        }
        if(submitter) {
          result.submitter = submitter.name;
          result.submitter_email = submitter.email;
        }
        else {
          result.submitter = result.submitter_id;
          result.submitter_email = null;
        }
        if(collaborators) {result.collaborators = collaborators;}
        //add status labels
        result.status_label = helpers.fmt('<span class="ticket_status_label %@">%@</span>', result.status, result.status);
      }.bind(this));
      // create export
      var url;
      if (this.exportEnabled === true) {
        var data = this.renderTemplate('_tickets_export', {
          tickets: results,
          columns: this.columns
        });
        var file = new File([data], 'tickets.csv');
        url = URL.createObjectURL(file);
      } else {
        url = false;
      }
      // display results
      var results_html = this.renderTemplate('results', {
        results: results,
        // encoded_results: this.encoded,
        count: this.numberOfResults,
        next_page: this.next_page,
        prev_page: this.prev_page,
        columns: this.columns,
        download: url,
        exportEnabled: this.exportEnabled
      });
      this.$("span.loading").hide();
      this.$('div.results').html(results_html);
    }
  };
}());
;
}
var app = ZendeskApps.defineApp(source)
  .reopenClass({"location":{"zendesk":{"nav_bar":"_legacy"}},"noTemplate":false,"singleInstall":false,"signedUrls":false})
  .reopen({
    appName: "Advanced Search",
    appVersion: "0.10.2",
    assetUrlPrefix: "https://45270.apps.zdusercontent.com/45270/assets/1472678854-c2f2f8e3b6e5266878af14c9ef901a88/",
    appClassName: "app-45270",
    author: {
      name: "Joe McCarron",
      email: "success_apps@zendesk.com"
    },
    translations: {"app":{"description":"Play the famous zen tunes in your help desk.","name":"Buddha Machine"},"loading":"Welcome to this Sample App","fetch":{"done":"Good","fail":"failed to fecth information from the server"},"id":"ID","email":"Email","role":"Role","groups":"Groups"},
    templates: {"_tickets_export":"id{{#if columns.subject}},Subject{{/if}}{{#if columns.requester}},\"Requester Name\"{{/if}}{{#if columns.requester_email}},\"Requester Email\"{{/if}}{{#if columns.group}},Group{{/if}}{{#if columns.assignee}},\"Assignee Name\"{{/if}}{{#if columns.assignee_email}},\"Assignee Email\"{{/if}}{{#if columns.status}},Status{{/if}}{{#if columns.type}},Type{{/if}}{{#if columns.priority}},Priority{{/if}}{{#if columns.created_at}},Created{{/if}}{{#if columns.updated_at}},Updated{{/if}}{{#if columns.external_id}},External_ID{{/if}}{{#if columns.channel}},Channel{{/if}}{{#if columns.description}},Description{{/if}}{{#if columns.recipient}},Recipient{{/if}}{{#if columns.submitter}},Submitter{{/if}}{{#if columns.organization}},Organization{{/if}}{{#if columns.collaborators}},CCs{{/if}}{{#if columns.forum_topic}},Topic{{/if}}{{#if columns.problem_id}},Problem{{/if}}{{#if columns.has_incidents}},Incidents{{/if}}{{#if columns.tags}},Tags{{/if}}{{#each columns.customFields}},{{title}}{{/each}}\n{{#tickets}}{{id}}{{#if ../columns.subject}},\"{{{subject}}}\"{{/if}}{{#if ../columns.requester}},\"{{requester}}\"{{/if}}{{#if ../columns.requester_email}},\"{{requester_email}}\"{{/if}}{{#if ../columns.group}},{{group_id}}{{/if}}{{#if ../columns.assignee}},{{assignee}}{{/if}}{{#if ../columns.assignee_email}},{{assignee_email}}{{/if}}{{#if ../columns.status}},{{status}}{{/if}}{{#if ../columns.type}},{{type}}{{/if}}{{#if ../columns.priority}},{{priority}}{{/if}}{{#if ../columns.created_at}},\"{{created_at}}\"{{/if}}{{#if ../columns.updated_at}},\"{{updated_at}}\"{{/if}}{{#if ../columns.external_id}},\"{{external_id}}\"{{/if}}{{#if ../columns.channel}},\"{{channel}}\"{{/if}}{{#if ../columns.description}},\"{{{description}}}\"{{/if}}{{#if ../columns.recipient}},\"{{recipient}}\"{{/if}}{{#if ../columns.submitter}},\"{{submitter}}\"{{/if}}{{#if ../columns.submitter_email}},\"{{submitter_email}}\"{{/if}}{{#if ../columns.organization}},{{organization}}{{/if}}{{#if ../columns.collaborators}},\"{{collaborators}}\"{{/if}}{{#if ../columns.forum_topic}},{{forum_topic}}{{/if}}{{#if ../columns.problem_id}},{{problem_id}}{{/if}}{{#if ../columns.has_incidents}},{{has_incidents}}{{/if}}{{#if ../columns.tags}},\"{{tags}}\"{{/if}}{{#each custom_fields}},\"{{#if textarea}}{{{value}}}{{else}}{{value}}{{/if}}\"{{/each}}\n{{/tickets}}","layout":"\u003cstyle\u003e\n.app-45270 {\n  /*.ticket_options label {\n    display: block;\n  }*/ }\n  .app-45270 header .logo {\n    background-image: url(\"https://45270.apps.zdusercontent.com/45270/assets/1472678854-c2f2f8e3b6e5266878af14c9ef901a88/logo-small.png\"); }\n  .app-45270 input {\n    border: 1px solid #d3d3d3; }\n  .app-45270 .column input {\n    width: 400px;\n    margin-bottom: 10px; }\n  .app-45270 .column_1 {\n    float: left;\n    margin-right: 20px; }\n  .app-45270 .results-well {\n    overflow: scroll; }\n  .app-45270 .no_wrap {\n    white-space: nowrap; }\n  .app-45270 input[type=\"checkbox\"] {\n    vertical-align: middle;\n    margin-bottom: 4px; }\n  .app-45270 a.pull-right {\n    margin-top: 10px; }\n  .app-45270 a.pull-right.btn {\n    margin-top: 0px; }\n\u003c/style\u003e\n\u003cheader\u003e\n  \u003cspan class=\"logo\"/\u003e\n  \u003ch3\u003e{{setting \"name\"}} \n    \u003ca href=\"https://github.com/zendesklabs/advanced_search\"\u003e\u003ci class=\"icon-question-sign\"\u003e\u003c/i\u003e\u003c/a\u003e \n  \u003c/h3\u003e\n\u003c/header\u003e\n\u003csection data-main/\u003e\n\u003cfooter\u003e\n  \u003csmall class=\"pull-right\"\u003eby \n    \u003ca href=\"https://github.com/jstjoe\" class=\"muted\"\u003e{{author.name}}\u003c/a\u003e\u0026nbsp;\u0026nbsp;\n  \u003c/small\u003e\n\u003c/footer\u003e","main":"\u003cdiv class=\"container-fluid\"\u003e\n  \u003cform class=\"form-inline main_search\"\u003e \n    \u003clabel\u003eSearch\u003c/label\u003e\n    \u003cinput class=\"string\" type=\"search\" id=\"input\" name=\"search\" autofocus\u003e\u003c/input\u003e\n    \u0026nbsp;\u0026nbsp;\n    \u003clabel\u003eType\u003c/label\u003e\n    \u003cselect class=\"type\"\u003e\n      \u003coption value=\"ticket\"\u003etickets\u003c/option\u003e\n      \u003coption value=\"topic\" disabled\u003etopics\u003c/option\u003e\n      \u003coption value=\"user\" disabled\u003eusers\u003c/option\u003e\n      \u003coption value=\"organization\" disabled\u003eorganizations\u003c/option\u003e\n    \u003c/select\u003e\n    \u0026nbsp;\u0026nbsp;\n    \u003clabel\u003eSort By\u003c/label\u003e\n    \u003cselect class=\"sort_by\" name=\"sort_by\"\u003e\n      \u003coption value=\"relevance\"\u003erelevance\u003c/option\u003e\n      \u003coption value=\"updated_at\"\u003eupdated at\u003c/option\u003e\n      \u003coption value=\"created_at\"\u003ecreated at\u003c/option\u003e\n      \u003coption value=\"priority\"\u003epriority\u003c/option\u003e\n      \u003coption value=\"status\"\u003estatus\u003c/option\u003e\n      \u003coption value=\"ticket_type\"\u003eticket type\u003c/option\u003e\n    \u003c/select\u003e\n    \u0026nbsp;\u0026nbsp;\n    \u003clabel\u003eSort Order\u003c/label\u003e\n    \u003cselect class=\"sort_order\" name=\"sort_order\"\u003e\n      \u003coption value=\"desc\"\u003eDescending\u003c/option\u003e\n      \u003coption value=\"asc\"\u003eAscending\u003c/option\u003e\n    \u003c/select\u003e\n    \u0026nbsp;\u0026nbsp;\n    \u003cbutton class=\"search btn btn-primary\" id=\"enter\"\u003eSearch\u003c/button\u003e\n    \u0026nbsp;\u0026nbsp;\n    \u003clabel\u003eAll Pages \u003ci class=\"icon-fire\"\u003e\u003c/i\u003e\u003c/label\u003e\n    \u003cinput class=\"all_pages\" type=\"checkbox\"\u003e\u003c/input\u003e\n    \u0026nbsp;\u0026nbsp;\n    \u003ca href=\"https://support.zendesk.com/entries/20239737\" class=\"pull-right\" target=\"blank\"\u003eSearch Options \u003ci class=\"icon-info-sign\"\u003e\u003c/i\u003e\u003c/a\u003e\n  \u003c/form\u003e\u003cbr\u003e\n\n  \u003cdiv class=\"type_options\"\u003e\n    {{!-- inject options here --}}\n  \u003c/div\u003e\n  \u003cdiv class=\"results\"\u003e\n    {{!-- inject results here --}}\n    \n  \u003c/div\u003e\n  \u003cspan class=\"loading\"\u003e{{spinner \"dotted\"}}\u003c/span\u003e\n  \u003cspan class=\"no_results\"\u003eThis query has no results. Try broadening your search.\u003c/span\u003e\n\u003c/div\u003e","results":"{{#if exportEnabled}}\u003ch3\u003eResults ({{count}}) \u003ca href=\"{{download}}\" download=\"tickets.csv\" class=\"btn pull-right\"\u003e\u003ci class=\"icon-download\"\u003e\u003c/i\u003e Download CSV\u003c/a\u003e\u003c/h3\u003e{{/if}}\n\n\u003cbr\u003e\n\u003cdiv class=\"well results-well\"\u003e\n\u003ctable class=\"table\"\u003e\n  \u003cthead\u003e\n    {{!-- if result_type == ticket --}}\n    \u003cth\u003e\n      {{#if columns.id}}\u003ctd\u003eID\u003c/td\u003e{{/if}}\n      {{#if columns.subject}}\u003ctd\u003eSubject\u003c/td\u003e{{/if}}\n      {{#if columns.requester}}\u003ctd\u003eRequester Name\u003c/td\u003e{{/if}}\n      {{#if columns.requester_email}}\u003ctd\u003eRequester Email\u003c/td\u003e{{/if}}\n      {{#if columns.group}}\u003ctd\u003eGroup\u003c/td\u003e{{/if}}\n      {{#if columns.assignee}}\u003ctd\u003eAssignee Name\u003c/td\u003e{{/if}}\n      {{#if columns.assignee_email}}\u003ctd\u003eAssignee Email\u003c/td\u003e{{/if}}\n      {{#if columns.status}}\u003ctd\u003eStatus\u003c/td\u003e{{/if}}\n      {{#if columns.type}}\u003ctd\u003eType\u003c/td\u003e{{/if}}\n      {{#if columns.priority}}\u003ctd\u003ePriority\u003c/td\u003e{{/if}}\n      {{#if columns.created_at}}\u003ctd\u003eCreated\u003c/td\u003e{{/if}}\n      {{#if columns.updated_at}}\u003ctd\u003eUpdated\u003c/td\u003e{{/if}}\n\n      {{#if columns.external_id}}\u003ctd\u003eExternal ID\u003c/td\u003e{{/if}}\n      {{#if columns.channel}}\u003ctd\u003eChannel\u003c/td\u003e{{/if}}\n      {{#if columns.description}}\u003ctd\u003eDescription\u003c/td\u003e{{/if}}\n      {{#if columns.recipient}}\u003ctd\u003eRecipient Address\u003c/td\u003e{{/if}}\n      {{#if columns.submitter}}\u003ctd\u003eSubmitter Name\u003c/td\u003e{{/if}}\n      {{#if columns.submitter_email}}\u003ctd\u003eSubmitter Email\u003c/td\u003e{{/if}}\n      {{#if columns.organization}}\u003ctd\u003eOrganization\u003c/td\u003e{{/if}}\n      {{#if columns.collaborators}}\u003ctd\u003eCCs\u003c/td\u003e{{/if}}\n      {{#if columns.forum_topic}}\u003ctd\u003eLinked Topic\u003c/td\u003e{{/if}}\n      {{#if columns.problem_id}}\u003ctd\u003eLinked Problem\u003c/td\u003e{{/if}}\n      {{#if columns.has_incidents}}\u003ctd\u003eHas Incidents?\u003c/td\u003e{{/if}}\n      {{#if columns.tags}}\u003ctd\u003eTags\u003c/td\u003e{{/if}}\n\n      {{#each columns.customFields}}\n      {{!-- prints the custom field's ID as a column --}}\n        \u003ctd\u003e{{title}}\u003c/td\u003e\n\n      {{/each}}\n      \n    \u003c/th\u003e\n    {{!-- if topic --}}\n\n    {{!-- if user --}}\n\n    {{!-- if organization --}}\n\n  \u003c/thead\u003e\n  \u003ctbody\u003e\n    {{#results}}\n    {{!-- if ticket --}}\n\n    \u003ctr class=\"row\"\u003e\n      {{#if ../columns.id}}\n        \u003ctd\u003e\u003ca href=\"#/tickets/{{id}}\"\u003e{{id}}\u003c/a\u003e\u003c/td\u003e\n      {{/if}}\n      {{#if ../columns.subject}}\n        \u003ctd\u003e\u003ca href=\"#/tickets/{{id}}\"\u003e{{subject}}\u003c/a\u003e\u003c/td\u003e\n      {{/if}}\n      {{#if ../columns.requester}}\n        \u003ctd\u003e\u003ca href=\"#/users/{{requester_id}}\"\u003e{{requester}}\u003c/a\u003e\u003c/td\u003e\n      {{/if}}\n      {{#if ../columns.requester_email}}\n        \u003ctd\u003e{{requester_email}}\u003c/td\u003e\n      {{/if}}\n      {{#if ../columns.group}}\n        \u003ctd\u003e{{group_id}}\u003c/td\u003e\n      {{/if}}\n      {{#if ../columns.assignee}}\n        \u003ctd\u003e\u003ca href=\"#/users/{{assignee_id}}\"\u003e{{assignee}}\u003c/a\u003e\u003c/td\u003e\n      {{/if}}\n      {{#if ../columns.assignee_email}}\n        \u003ctd\u003e{{assignee_email}}\u003c/td\u003e\n      {{/if}}\n      {{#if ../columns.status}}\n        \u003ctd\u003e{{{status_label}}}\u003c/td\u003e\n      {{/if}}\n      {{#if ../columns.type}}\n        \u003ctd\u003e{{#if type}}\u003cspan class=\"label\"\u003e{{type}}\u003c/span\u003e{{/if}}\u003c/td\u003e\n      {{/if}}\n      {{#if ../columns.priority}}\n        \u003ctd\u003e{{priority}}\u003c/td\u003e\n      {{/if}}\n      {{#if ../columns.created_at}}\n        \u003ctd\u003e{{created_at}}\u003c/td\u003e\n      {{/if}}\n      {{#if ../columns.updated_at}}\n        \u003ctd\u003e{{updated_at}}\u003c/td\u003e\n      {{/if}}\n\n      {{#if ../columns.external_id}}\n        \u003ctd\u003e{{external_id}}\u003c/td\u003e\n      {{/if}}\n      {{#if ../columns.channel}}\n        \u003ctd\u003e{{via.channel}}\u003c/td\u003e\n      {{/if}}\n      {{#if ../columns.description}}\n        \u003ctd\u003e{{description}}\u003c/td\u003e\n      {{/if}}\n      {{#if ../columns.recipient}}\n        \u003ctd\u003e{{recipient}}\u003c/td\u003e\n      {{/if}}\n      {{#if ../columns.submitter}}\n        \u003ctd\u003e\u003ca href=\"#/users/{{submitter_id}}\"\u003e{{submitter}}\u003c/a\u003e\u003c/td\u003e\n      {{/if}}\n      {{#if ../columns.submitter_email}}\n        \u003ctd\u003e{{submitter_email}}\u003c/td\u003e\n      {{/if}}\n      {{#if ../columns.organization}}\n        \u003ctd\u003e{{organization_id}}\u003c/td\u003e\n      {{/if}}\n      {{#if ../columns.collaborators}}\n        \u003ctd\u003e{{#each collaborators}}\u003ca href=\"#/users/{{this.id}}\"\u003e{{this.name}}\u003c/a\u003e{{#unless @last}}, {{/unless}}{{/each}}\u003c/td\u003e\n      {{/if}}\n      {{#if ../columns.forum_topic}}\n        \u003ctd\u003e{{forum_topic}}\u003c/td\u003e\n      {{/if}}\n      {{#if ../columns.problem_id}}\n        \u003ctd\u003e{{problem_id}}\u003c/td\u003e\n      {{/if}}\n      {{#if ../columns.has_incidents}}\n        \u003ctd\u003e{{has_incidents}}\u003c/td\u003e\n      {{/if}}\n      {{#if ../columns.tags}}\n        \u003ctd\u003e{{tags}}\u003c/td\u003e\n      {{/if}}\n\n      {{#if ../columns.customFields}}\n        {{#each custom_fields}}\n          {{!-- prints the custom fields as a column --}}\n          \u003ctd\u003e{{value}}\u003c/td\u003e\n        {{/each}}\n      {{/if}}\n    \u003c/tr\u003e\n\n    {{!-- if topic --}}\n\n    {{!-- if user --}}\n\n    {{!-- if organization --}}\n    {{/results}}\n  \u003c/tbody\u003e\n\u003c/table\u003e\n\u003c/div\u003e\n{{!-- pagination --}}\n\n\u003cul class=\"pager\"\u003e\n  {{#if prev_page}}\n  \u003cli class=\"previous\"\u003e\n    \u003ca href=\"#\" class=\"prev_page\"\u003e\u0026larr; Previous page\u003c/a\u003e\n  \u003c/li\u003e\n  {{/if}}\n  {{#if next_page}}\n  \u003cli class=\"next\"\u003e\n    \u003ca href=\"#\" class=\"next_page\"\u003eNext page \u0026rarr;\u003c/a\u003e\n  \u003c/li\u003e\n  {{/if}}\n\u003c/ul\u003e","ticket_filter_string":"{{#filters}}{{#if status}} status{{{status}}}{{/if}}{{#if ticket_type}} ticket_type:{{ticket_type}}{{/if}}{{#if priority}} priority{{{priority}}}{{/if}}{{#if date}} {{{date}}}{{/if}}{{#if group}} group:\"{{group}}\"{{/if}}{{#if assignee}} assignee:\"{{assignee}}\"{{/if}}{{#if submitter}} submitter:\"{{submitter}}\"{{/if}}{{#if organization}} organization:\"{{organization}}\"{{/if}}{{#if requester}} requester:\"{{requester}}\"{{/if}}{{#if commenter}} commenter:\"{{commenter}}\"{{/if}}{{#if cc}} cc:\"{{cc}}\"{{/if}}{{#if subject}} subject:\"{{subject}}\"{{/if}}{{#if description}} description:\"{{description}}\"{{/if}}{{#if tags}} tags:\"{{tags}}\"{{/if}}{{#if via}} via:{{via}}{{/if}}{{/filters}}","ticket_options":"\u003cform class=\"ticket_options ticket_filters form-inline well\"\u003e\n  \u003clabel\u003eStatus \u003c/label\u003e\n  \u003cselect class=\"status_operator\"\u003e\n    \u003coption\u003e\u003c/option\u003e\n    \u003coption value=\":\"\u003e = \u003c/option\u003e\n    \u003coption value=\"greater\"\u003e \u0026gt; \u003c/option\u003e\n    \u003coption value=\"less\"\u003e \u0026lt; \u003c/option\u003e\n  \u003c/select\u003e\n  \u003cselect class=\"status_value\"\u003e\n    \u003coption\u003e\u003c/option\u003e\n    \u003coption value=\"new\"\u003enew\u003c/option\u003e\n    \u003coption value=\"open\"\u003eopen\u003c/option\u003e\n    \u003coption value=\"pending\"\u003epending\u003c/option\u003e\n    \u003coption value=\"hold\"\u003eon-hold\u003c/option\u003e\n    \u003coption value=\"solved\"\u003esolved\u003c/option\u003e\n    \u003coption value=\"closed\"\u003eclosed\u003c/option\u003e\n  \u003c/select\u003e\n  \u0026nbsp;\u0026nbsp;\n  \u003clabel\u003eType\u003c/label\u003e\n  \u003cselect class=\"ticket_type\"\u003e\n    \u003coption\u003e\u003c/option\u003e\n    \u003coption value=\"question\"\u003equestion\u003c/option\u003e\n    \u003coption value=\"problem\"\u003eproblem\u003c/option\u003e\n    \u003coption value=\"incident\"\u003eincident\u003c/option\u003e\n    \u003coption value=\"task\"\u003etask\u003c/option\u003e\n  \u003c/select\u003e\n  \u0026nbsp;\u0026nbsp;\n  \u003clabel\u003ePriority \u003c/label\u003e\n  \u003cselect class=\"priority_operator\"\u003e\n    \u003coption\u003e\u003c/option\u003e\n    \u003coption value=\":\"\u003e = \u003c/option\u003e\n    \u003coption value=\"greater\"\u003e \u0026gt; \u003c/option\u003e\n    \u003coption value=\"less\"\u003e \u0026lt; \u003c/option\u003e\n  \u003c/select\u003e\n  \u003cselect class=\"priority_value\"\u003e\n    \u003coption\u003e\u003c/option\u003e\n    \u003coption value=\"urgent\"\u003eurgent\u003c/option\u003e\n    \u003coption value=\"high\"\u003ehigh\u003c/option\u003e\n    \u003coption value=\"normal\"\u003enormal\u003c/option\u003e\n    \u003coption value=\"low\"\u003elow\u003c/option\u003e\n  \u003c/select\u003e\n  \u0026nbsp;\u0026nbsp;\n  \u003clabel\u003eDate \u003c/label\u003e\n  \u003cselect class=\"date_type\" name=\"date_type\"\u003e\n    \u003coption\u003e\u003c/option\u003e\n    \u003coption value=\"created\"\u003ecreated\u003c/option\u003e\n    \u003coption value=\"updated\"\u003eupdated\u003c/option\u003e\n    \u003coption value=\"solved\"\u003esolved\u003c/option\u003e\n    \u003coption value=\"due_date\"\u003edue\u003c/option\u003e\n  \u003c/select\u003e\n  {{!-- this should be conditional on a date filter being selected above --}}\n  \u003cselect class=\"date_operator\"\u003e\n    \u003coption\u003e\u003c/option\u003e\n    \u003coption value=\":\"\u003e = \u003c/option\u003e\n    \u003coption value=\"greater\"\u003e \u0026gt; \u003c/option\u003e\n    \u003coption value=\"less\"\u003e \u0026lt; \u003c/option\u003e\n  \u003c/select\u003e\n  \u003cinput class=\"date_value\" type=\"date\"\u003e\u003c/input\u003e \n  \u003cbr\u003e\u003cbr\u003e\n{{!-- line 2 --}}\n  \u003cdiv class=\"column column_1\"\u003e\n    \u003clabel\u003eGroup\u003c/label\u003e\u003cbr\u003e\n    \u003cinput class=\"group\"\u003e\u003c/input\u003e\n    \u003cbr\u003e\n    \u003clabel\u003eOrganization\u003c/label\u003e\u003cbr\u003e\n    \u003cinput id=\"organization\" class=\"organization\"\u003e\u003c/input\u003e\n    \u003cbr\u003e\n    \u003clabel\u003eCommenter\u003c/label\u003e\u003cbr\u003e\n    \u003cinput id=\"commenter\" class=\"commenter user\"\u003e\u003c/input\u003e\n    \u003cbr\u003e\n    \u003clabel\u003eSubject\u003c/label\u003e\u003cbr\u003e\n    \u003cinput class=\"subject\"\u003e\u003c/input\u003e\n    \u003cbr\u003e\n    \u003clabel\u003eTags\u003c/label\u003e\u003cbr\u003e\n    \u003cinput class=\"tags\"\u003e\u003c/input\u003e\n    \u003cbr\u003e\n  \u003c/div\u003e\n\n{{!-- column 2 --}}\n  \u003cdiv class=\"column column_2\"\u003e\n    \u003clabel\u003eAssignee\u003c/label\u003e\u003cbr\u003e\n    \u003cinput id=\"assignee\" class=\"assignee user\"\u003e\u003c/input\u003e\n    \u003cbr\u003e\n    \u003clabel\u003eRequester\u003c/label\u003e\u003cbr\u003e\n    \u003cinput id=\"requester\" class=\"requester user\"\u003e\u003c/input\u003e\n    \u003cbr\u003e\n    \u003clabel\u003eCC\u003c/label\u003e\u003cbr\u003e\n    \u003cinput id=\"cc\" class=\"cc user\"\u003e\u003c/input\u003e\n    \u003cbr\u003e\n    \u003clabel\u003eDescription\u003c/label\u003e\u003cbr\u003e\n    \u003cinput class=\"description\"\u003e\u003c/input\u003e\n    \u003cbr\u003e\n    \u003clabel\u003eVia\u003c/label\u003e\u003cbr\u003e\n    \u003cselect class=\"via\"\u003e\n      \u003coption\u003e\u003c/option\u003e\n      \u003coption value=\"mail\"\u003email\u003c/option\u003e\n      \u003coption value=\"get_satisfaction\"\u003eget_satisfaction\u003c/option\u003e\n      \u003coption value=\"dropbox\"\u003edropbox\u003c/option\u003e\n      \u003coption value=\"twitter_dm\"\u003etwitter_dm\u003c/option\u003e\n      \u003coption value=\"twitter_fav\"\u003etwitter_fav\u003c/option\u003e\n      \u003coption value=\"twitter\"\u003etwitter\u003c/option\u003e\n      \u003coption value=\"voicemail\"\u003evoicemail\u003c/option\u003e\n      \u003coption value=\"phone_call_inbound\"\u003ephone_call_inbound\u003c/option\u003e\n      \u003coption value=\"phone_call_outbound\"\u003ephone_call_outbound\u003c/option\u003e\n      \u003coption value=\"phone\"\u003ephone\u003c/option\u003e\n      \u003coption value=\"sms\"\u003esms\u003c/option\u003e\n      \u003coption value=\"logmein\"\u003elogmein\u003c/option\u003e\n    \u003c/select\u003e\n  \u003c/div\u003e\n\n\n\u003c/form\u003e\n\n\u003cform class=\"ticket_columns form-inline well\"\u003e\n  \u003ch4\u003eColumns\u003c/h4\u003e\n  \u003cdiv\u003e\n    \u003ch5\u003eSystem Attributes\u003c/h5\u003e\n    \u003cinput type=\"checkbox\" checked class=\"column_check id\"\u003e ID \u003c/input\u003e|\n    \u003cinput type=\"checkbox\" checked class=\"column_check type\"\u003e Type \u003c/input\u003e|\n    \u003cinput type=\"checkbox\" checked class=\"column_check subject\"\u003e Subject \u003c/input\u003e|\n    \u003cinput type=\"checkbox\" checked class=\"column_check group\"\u003e Group \u003c/input\u003e|\n    \u003cinput type=\"checkbox\" checked class=\"column_check assignee\"\u003e Assignee Name\u003c/input\u003e|\n    \u003cinput type=\"checkbox\" checked class=\"column_check assignee_email\"\u003e Assignee Email\u003c/input\u003e|\n    \u003cinput type=\"checkbox\" checked class=\"column_check requester\"\u003e Requester Name\u003c/input\u003e|\n    \u003cinput type=\"checkbox\" checked class=\"column_check requester_email\"\u003e Requester Email\u003c/input\u003e|\n    \u003cinput type=\"checkbox\" checked class=\"column_check status\"\u003e Status \u003c/input\u003e|\n    \u003cinput type=\"checkbox\" checked class=\"column_check priority\"\u003e Priority \u003c/input\u003e|\n    \u003cinput type=\"checkbox\" checked class=\"column_check created\"\u003e Created at \u003c/input\u003e|\n    \u003cinput type=\"checkbox\" checked class=\"column_check updated\"\u003e Updated at \u003c/input\u003e\n    \u003cbr\u003e\n    \u003cinput type=\"checkbox\" class=\"column_check external_id\"\u003e External ID \u003c/input\u003e|\n    \u003cinput type=\"checkbox\" class=\"column_check channel\"\u003e Channel \u003c/input\u003e|\n    \u003cinput type=\"checkbox\" class=\"column_check description\"\u003e Description \u003c/input\u003e|\n    \u003cinput type=\"checkbox\" class=\"column_check recipient\"\u003e Recipient address \u003c/input\u003e|\n    \u003cinput type=\"checkbox\" class=\"column_check submitter\"\u003e Submitter Name\u003c/input\u003e|\n    \u003cinput type=\"checkbox\" class=\"column_check submitter_email\"\u003e Submitter Email\u003c/input\u003e|\n    \u003cinput type=\"checkbox\" class=\"column_check organization\"\u003e Organization \u003c/input\u003e|\n    \u003cinput type=\"checkbox\" class=\"column_check collaborators\"\u003e Collaborator(s) \u003c/input\u003e|\n    \u003cinput type=\"checkbox\" class=\"column_check forum_topic\"\u003e Forum Topic \u003c/input\u003e|\n    \u003cinput type=\"checkbox\" class=\"column_check problem_id\"\u003e Problem ID \u003c/input\u003e|\n    \u003cinput type=\"checkbox\" class=\"column_check has_incidents\"\u003e Has Incidents? \u003c/input\u003e|\n    \u003cinput type=\"checkbox\" class=\"column_check tags\"\u003e Tags \u003c/input\u003e\n  \u003c/div\u003e\n  \u003cbr\u003e\n  \u003ch5\u003eCustom Fields\u003c/h5\u003e\n  \u003cdiv class=\"custom_field_options\"\u003e\n    {{!-- insert custom field checkboxes here --}}\n    {{#each customFields}}\n      \u003cspan class=\"no_wrap\"\u003e\u003cinput type=\"checkbox\" data-field-option-id=\"{{id}}\"\u003e {{title}} \u003c/input\u003e{{#unless @last}}|{{/unless}}\u003c/span\u003e\n    {{/each}}\n\n  \u003c/div\u003e\n\u003c/form\u003e","topic_options":"\u003clabel\u003eStatus \u003c/label\u003e\n\u003cselect class=\"status_operator\"\u003e\n  \u003coption\u003e\u003c/option\u003e\n  \u003coption value=\":\"\u003e = \u003c/option\u003e\n  \u003coption value=\"greater\"\u003e \u0026gt; \u003c/option\u003e\n  \u003coption value=\"less\"\u003e \u0026lt; \u003c/option\u003e\n\u003c/select\u003e\n\u003cselect class=\"status_value\"\u003e\n  \u003coption\u003e\u003c/option\u003e\n  \u003coption value=\"new\"\u003enew\u003c/option\u003e\n  \u003coption value=\"open\"\u003eopen\u003c/option\u003e\n  \u003coption value=\"pending\"\u003epending\u003c/option\u003e\n  \u003coption value=\"on-hold\"\u003eon-hold\u003c/option\u003e\n  \u003coption value=\"solved\"\u003esolved\u003c/option\u003e\n  \u003coption value=\"closed\"\u003eclosed\u003c/option\u003e\n\u003c/select\u003e\n\u0026nbsp;\u0026nbsp;\n\u003clabel\u003eType\u003c/label\u003e\n\u003cselect class=\"ticket_type\"\u003e\n  \u003coption\u003e\u003c/option\u003e\n  \u003coption value=\"question\"\u003equestion\u003c/option\u003e\n  \u003coption value=\"problem\"\u003eproblem\u003c/option\u003e\n  \u003coption value=\"incident\"\u003eincident\u003c/option\u003e\n  \u003coption value=\"task\"\u003etask\u003c/option\u003e\n\u003c/select\u003e\n\u0026nbsp;\u0026nbsp;\n\u003clabel\u003ePriority \u003c/label\u003e\n\u003cselect class=\"priority_operator\"\u003e\n  \u003coption\u003e\u003c/option\u003e\n  \u003coption value=\":\"\u003e = \u003c/option\u003e\n  \u003coption value=\"greater\"\u003e \u0026gt; \u003c/option\u003e\n  \u003coption value=\"less\"\u003e \u0026lt; \u003c/option\u003e\n\u003c/select\u003e\n\u003cselect class=\"priority_value\"\u003e\n  \u003coption\u003e\u003c/option\u003e\n  \u003coption value=\"urgent\"\u003eurgent\u003c/option\u003e\n  \u003coption value=\"high\"\u003ehigh\u003c/option\u003e\n  \u003coption value=\"normal\"\u003enormal\u003c/option\u003e\n  \u003coption value=\"low\"\u003elow\u003c/option\u003e\n\u003c/select\u003e\n\u0026nbsp;\u0026nbsp;\n\u003clabel\u003eDate \u003c/label\u003e\n\u003cselect class=\"date_type\" name=\"date_type\"\u003e\n  \u003coption\u003e\u003c/option\u003e\n  \u003coption value=\"created\"\u003ecreated\u003c/option\u003e\n  \u003coption value=\"updated\"\u003eupdated\u003c/option\u003e\n  \u003coption value=\"solved\"\u003esolved\u003c/option\u003e\n  \u003coption value=\"due_date\"\u003edue\u003c/option\u003e\n\u003c/select\u003e\n{{!-- this should be conditional on a date filter being selected above --}}\n\u003cselect class=\"date_operator\"\u003e\n  \u003coption\u003e\u003c/option\u003e\n  \u003coption value=\":\"\u003e = \u003c/option\u003e\n  \u003coption value=\"greater\"\u003e \u0026gt; \u003c/option\u003e\n  \u003coption value=\"less\"\u003e \u0026lt; \u003c/option\u003e\n\u003c/select\u003e\n\u003cinput class=\"date_value\" type=\"date\"\u003e\u003c/input\u003e \n\u003cbr\u003e\u003cbr\u003e\n\n\u003clabel\u003eGroup\u003c/label\u003e\n\u003cinput class=\"group\"\u003e\u003c/input\u003e\n\u0026nbsp;\u0026nbsp;\n\n\u003clabel\u003eAssignee\u003c/label\u003e\n\u003cinput class=\"assignee\"\u003e\u003c/input\u003e\n\u0026nbsp;\u0026nbsp;\n\u003clabel\u003eSubmitter\u003c/label\u003e\n\u003cinput class=\"submitter\"\u003e\u003c/input\u003e\n\u003cbr\u003e\u003cbr\u003e\n\n\u003clabel\u003eOrganization\u003c/label\u003e\n\u003cinput class=\"organization\"\u003e\u003c/input\u003e\n\u0026nbsp;\u0026nbsp;\n\u003clabel\u003eRequester\u003c/label\u003e\n\u003cinput class=\"requester\"\u003e\u003c/input\u003e\n\u003cbr\u003e\u003cbr\u003e\n\n\u003clabel\u003eCommenter\u003c/label\u003e\n\u003cinput class=\"commenter\"\u003e\u003c/input\u003e\n\u0026nbsp;\u0026nbsp;\n\u003clabel\u003eCC\u003c/label\u003e\n\u003cinput class=\"cc\"\u003e\u003c/input\u003e\n\u003cbr\u003e\u003cbr\u003e\n\n\u003clabel\u003eSubject\u003c/label\u003e\n\u003cinput class=\"subject\"\u003e\u003c/input\u003e\n\u0026nbsp;\u0026nbsp;\n\u003clabel\u003eDescription\u003c/label\u003e\n\u003cinput class=\"description\"\u003e\u003c/input\u003e\n\u003cbr\u003e\u003cbr\u003e\n\n\u003clabel\u003eTags\u003c/label\u003e\n\u003cinput class=\"tags\"\u003e\u003c/input\u003e\n\u0026nbsp;\u0026nbsp;\n\u003clabel\u003eVia\u003c/label\u003e\n\u003cselect class=\"via\"\u003e\n  \u003coption\u003e\u003c/option\u003e\n  \u003coption value=\"mail\"\u003email\u003c/option\u003e\n  \u003coption value=\"get_satisfaction\"\u003eget_satisfaction\u003c/option\u003e\n  \u003coption value=\"dropbox\"\u003edropbox\u003c/option\u003e\n  \u003coption value=\"twitter_dm\"\u003etwitter_dm\u003c/option\u003e\n  \u003coption value=\"twitter_fav\"\u003etwitter_fav\u003c/option\u003e\n  \u003coption value=\"twitter\"\u003etwitter\u003c/option\u003e\n  \u003coption value=\"voicemail\"\u003evoicemail\u003c/option\u003e\n  \u003coption value=\"phone_call_inbound\"\u003ephone_call_inbound\u003c/option\u003e\n  \u003coption value=\"phone_call_outbound\"\u003ephone_call_outbound\u003c/option\u003e\n  \u003coption value=\"phone\"\u003ephone\u003c/option\u003e\n  \u003coption value=\"sms\"\u003esms\u003c/option\u003e\n  \u003coption value=\"logmein\"\u003elogmein\u003c/option\u003e\n\u003c/select\u003e\n\n"},
    frameworkVersion: "1.0"
  });

ZendeskApps["Advanced Search"] = app;

    with( ZendeskApps.AppScope.create() ) {

  var source = (function() {

    return {

        comments: [],
        userCanDelete: false,

        requests: {
            getComments: function(ticket_id, page) {
                return {
                    url: helpers.fmt('/api/v2/tickets/%@/comments.json?page=%@', ticket_id, page)
                };
            },

            putTextRedaction: function(data, ticket_id, comment_id) {
                return {
                    url: helpers.fmt('/api/v2/tickets/%@/comments/%@/redact.json', ticket_id, comment_id),
                    dataType: 'JSON',
                    type: 'PUT',
                    contentType: 'application/json',
                    data: JSON.stringify(data)
                };
            },

            putAttachmentRedaction: function(ticket_id, comment_id, attachment_id) { //	REST API attachment redaction
                return {
                    url: helpers.fmt('/api/v2/tickets/%@/comments/%@/attachments/%@/redact.json', ticket_id, comment_id, attachment_id),
                    dataType: 'JSON',
                    type: 'PUT',
                    contentType: 'application/json',
                    data: '{"":""}'
                };
            },

            getCustomRoles: function(){
              return {
                url: '/api/v2/custom_roles.json'
              };
            }
        },

        events: {
            'app.activated': 'init',
            'click .submit_text': 'popText',
            'click .confirm_text_redaction': 'makeTextRedaction',
            'click .attach_redact': 'attachMenu',
            'click .AttachConfirm': 'confirmAttachment',
            'click .save_attach_redact': 'makeAttachmentRedaction',
            'click .AttachLeave': function(){
              this.switchTo('text_redact', {
                can_delete: this.userCanDelete
              });
            }
        },

        init: function() {
            this.comments = [];
            var ticket_id = this.ticket().id();
            var fetchedComments = this._paginate({
                request: 'getComments',
                entity: 'comments',
                id: ticket_id,
                page: 1
            });

            fetchedComments
                .done(_.bind(function(data) {
                    this.comments = data;
                }, this))
                .fail(_.bind(function() {
                    services.notify("Something went wrong and we couldn't reach the REST API to retrieve all comment data", 'error');
                }, this));
            var current_role_id = this.currentUser().role();
            if(current_role_id === 'admin' || current_role_id === 'agent'){
                this.userCanDelete = true;
                this.switchTo('text_redact', {
                    can_delete: this.userCanDelete
                });
            }
            else {
                this.ajax('getCustomRoles')
                .done(function(data){
                  var role_check = _.filter(data.custom_roles, function(role) {
                    return role.id === current_role_id;
                  });
                  var can_delete =  role_check[0].configuration.ticket_deletion;
                  this.userCanDelete = can_delete;
                  this.switchTo('text_redact', {
                    can_delete: this.userCanDelete
                    });
                })
                .fail(function(){
                  this.notifyFail();
                });
            }
        },

        popText: function() {
            var user_string = this.$('.redaction_string')[0].value;
            var comment_data = this.comments;
            var matched_comments = _.chain(comment_data)
                .filter(function(comment) { //	Creates a new object only including comments that contain the user's desired string
                    var body_text = comment.body;
                    return body_text.indexOf(user_string) > -1;
                })
                .value();
            var total_actions = matched_comments.length;
            if (user_string !== "") { //	If the string to be redacted isn't blank, then display the confirmation modal
                this.$('.text_redact').modal({ //	Fires a modal to display the string that will be redacted and how many times it appears on the ticket.
                    backdrop: true,
                    keyboard: false,
                    body: this.$('.modal-body div.string_presenter').text(user_string),
                    total_actions: this.$('.modal-body span.num_actions').text(total_actions)
                });
            } else { //	If the form is submitted without any content, then let the customer know what they did.
                services.notify('Your redaction cannot be blank. Double check that you have pasted content into the text area.', 'error');
            }
        },

        makeTextRedaction: function() {
            this.$('.text_redact').modal('hide');
            var user_string = this.$('.redaction_string')[0].value;
            var comment_data = this.comments;
            var matched_comments = _.chain(comment_data)
                .filter(function(comment) { //	Creates a new object only including comments that contain the user's desired string
                    var body_text = comment.body;
                    return body_text.indexOf(user_string) > -1;
                })
                .value();
            var total_actions = matched_comments.length;
            var ticket_id = this.ticket().id();
            var text_data = {
                "text": user_string
            };
            var requests = [];

            for (var x = 0; x < total_actions; x++) {
                var comment_id = matched_comments[x].id;
                requests.push(this.ajax('putTextRedaction', text_data, ticket_id, comment_id)); //	Fires the actual request to redact.json for text redactions
            }

            this._handleRequests(requests);
        },

        attachMenu: function() { //	Maps comments.json to provide an array of attachments and necessary data to redact and/or display them
            var comment_data = this.comments;
            var attachments = _.chain(comment_data)
                .filter(function(comment) {
                    return comment.attachments.length > 0;
                })
                .map(function(comment) {
                    return {
                        attachment_array: _.map(comment.attachments, function(attachment) {
                            return {
                                comment_id: comment.id,
                                attachment_id: attachment.id,
                                type: attachment.content_type,
                                url: attachment.content_url,
                                file: attachment.file_name
                            };
                        })
                    };
                })
                .map(function(comment) {
                    return comment.attachment_array;
                })
                .flatten(true)
                .filter(function(attachment) {
                    return attachment.file !== "redacted.txt";
                })
                .value();
            var count = attachments.length;
            for (var x = 0; x < count; x++) {
                attachments[x].key = x;
            }
            this.switchTo('redact_attach', { //	Fires off a function to take the attachment array and display a list of attachments available for redaction (minus redacted.txt files)
                attachments: attachments
            });
        },

        getSelectedAttachments: function() { //	Handler for grabbing the janky input from the attachment list template. Each attachment object has five hidden inputs that need to be grouped.
            var inputData = this.$('ul#attachmentList li input').serializeArray();
            var selected_attachments = _.chain(inputData)
                .groupBy(function(data) {
                    return data.name;
                })
                .filter(function(data) {
                    return data.length > 5;
                })
                .map(function(attachment) {
                    return { //	This is mapped in the order that hidden elements appear in the checkbox list. If that order changes, then the related array key will need to change.
                        selected: attachment[0].value,
                        attachment_id: attachment[1].value,
                        url: attachment[2].value,
                        file: attachment[3].value,
                        comment_id: attachment[4].value,
                        file_type: attachment[5].value
                    };
                })
                .value();
            return selected_attachments;
        },

        confirmAttachment: function() { //	Fires off a modal to confirm the attachments selected for redaction. Image attachments will show thumbnails, generic icon for others
            var selected_attachments = this.getSelectedAttachments();

            var attachList = '';
            var count = selected_attachments.length;
            if (count === 0) {
                this.$('.attach_noselection').modal({
                    backdrop: true,
                    keyboard: false
                });
                return false;
            }
            var generic_icon = this.assetURL('document_generic.png');
            for (var x = 0; x < count; x++) {
                if (selected_attachments[x].file_type.split("/")[0] == "image") { //	If the attachment is an image, show it.
                    attachList += '<li><img src=\"' + selected_attachments[x].url + '\" /> <span class=\"modal_filename\">' + selected_attachments[x].file + '</span></li>';
                } else { //	If the attachment is anything other than an image, show a generic file icon
                    attachList += '<li><img src=\"' + generic_icon + '\" /> <span class=\"modal_filename\">' + selected_attachments[x].file + '</span></li>';
                }
            }
            var presentedAttachments = '<p>You will be permanently removing the below files:</p><ul class=\"redaction_img_list\">' + attachList + '</ul>'; //	HTML to inject
            this.$('.attach_redact').modal({ //	The above funciton and iteration is a bit dirty. Can be cleaned up using something like 'var html = this.renderTemplate()'
                backdrop: true,
                keyboard: false,
                body: this.$('.modal-body div.attachPresenter').html(presentedAttachments)
            });
        },

        makeAttachmentRedaction: function() {
            this.$('.attach_redact').modal('hide');
            var selected_attachments = this.getSelectedAttachments();
            var count = selected_attachments.length;
            var ticket_id = this.ticket().id();
            var requests = [];

            for (var x = 0; x < count; x++) {
                var comment_id = selected_attachments[x].comment_id;
                var attachment_id = selected_attachments[x].attachment_id;
                requests.push(this.ajax('putAttachmentRedaction', ticket_id, comment_id, attachment_id));
            }

            this._handleRequests(requests);
        },

        _paginate: function(a) {
            var results = [];
            var initialRequest = this.ajax(a.request, a.id, a.page);
            // create and return a promise chain of requests to subsequent pages
            var allPages = initialRequest.then(function(data) {
                results.push(data[a.entity]);
                var nextPages = [];
                var pageCount = Math.ceil(data.count / 100);
                for (; pageCount > 1; --pageCount) {
                    nextPages.push(this.ajax(a.request, a.id, pageCount));
                }
                return this.when.apply(this, nextPages).then(function() {
                    var entities = _.chain(arguments)
                        .flatten()
                        .filter(function(item) {
                            return (_.isObject(item) && _.has(item, a.entity));
                        })
                        .map(function(item) {
                            return item[a.entity];
                        })
                        .value();
                    results.push(entities);
                }).then(function() {
                    return _.chain(results)
                        .flatten()
                        .compact()
                        .value();
                });
            });
            return allPages;
        },

        _handleRequests: function(requests) {
            this.when.apply(this, requests).done(_.bind(function() {
                this.notifySuccess();
                this.init();
            }, this))
                .fail(_.bind(function() {
                    this.notifyFail();
                }, this));
        },

        notifySuccess: function() { //	Cannot refresh ticket data from app, user must refresh page.
            services.notify('Your redactions were successful. Refresh the page to update this ticket view.');
        },

        notifyFail: function() { //	Whoops?
            services.notify('One or more of the redactions failed...please try again', 'error');
        }
    };

}());
;

  var app = ZendeskApps.defineApp(source)
    .reopenClass({"location":"ticket_sidebar","noTemplate":false,"singleInstall":false})
    .reopen({
      assetUrlPrefix: "/api/v2/apps/42515/assets/",
      appClassName: "app-42515",
      author: {
        name: "Zendesk Labs",
        email: "zendesklabs@zendesk.com"
      },
      translations: {"app":{}},
      templates: {"layout":"\u003cstyle\u003e\n.app-42515 header .logo {\n  background-image: url(\"/api/v2/apps/42515/assets/logo-small.png\"); }\n.app-42515 textarea#redaction_string {\n  text-indent: 0;\n  padding: 2px;\n  min-height: 150px;\n  margin-top: 15px;\n  width: 100%; }\n.app-42515 div.modal-body {\n  margin: 10px; }\n.app-42515 div.string_presenter {\n  min-height: 200px;\n  margin: 10px 0;\n  text-align: left;\n  text-decoration: underline;\n  padding-top: 15px;\n  border-top: 1px dotted #b2b2b2; }\n.app-42515 .modal {\n  width: 700px; }\n.app-42515 span.tiny_note {\n  font-style: italic; }\n.app-42515 span.num_actions {\n  color: #e91010; }\n.app-42515 span.breakline {\n  display: block;\n  width: 100%;\n  border-bottom: 1px dotted #666;\n  margin: 10px 0;\n  clear: both; }\n.app-42515 button.submit_text {\n  margin: 2% 0 2% 65%; }\n.app-42515 button.attach_redact {\n  float: right; }\n.app-42515 label#attach_redact_label {\n  float: left;\n  font-size: 120%;\n  margin-top: 5px; }\n.app-42515 #attach_redact:after {\n  clear: both; }\n.app-42515 #attachLeave {\n  float: left; }\n.app-42515 #attachConfirm {\n  float: right; }\n.app-42515 .filename {\n  margin-left: 10px; }\n.app-42515 .redaction_img_list li img {\n  max-width: 50%;\n  margin-right: 25px;\n  max-height: 100px; }\n.app-42515 .redaction_img_list li {\n  height: 102px;\n  width: 90%;\n  border-bottom: 1px dotted #7b7b7b;\n  margin: 20px 0 5px 15px;\n  position: relative;\n  padding-bottom: 15px; }\n.app-42515 .redaction_img_list span.modal_filename {\n  text-align: right;\n  position: absolute;\n  top: 5px;\n  right: 15px;\n  font-size: 14px;\n  max-width: 50%; }\n.app-42515 .warn_unable {\n  display: inline-block;\n  padding-top: 20px;\n  font-size: 90%;\n  color: red; }\n\u003c/style\u003e\n\u003cheader\u003e\n  \u003cspan class=\"logo\"/\u003e\n  \u003ch3\u003e{{setting \"name\"}}\u003c/h3\u003e\n\u003c/header\u003e\n\u003csection data-main/\u003e","redact_attach":"\u003csection data-main\u003e\n  \u003ch4 class=\"redaction-type\"\u003eAttachment Redaction\u003c/h4\u003e\n  \u003cdiv class=\"attachForm\"\u003e\n    \u003cul id=\"attachmentList\"\u003e\n      {{#each attachments}}\n      \u003cli\u003e\n        \u003cinput class=\"attach_check\" type=\"checkbox\" name=\"{{this.key}}\" /\u003e\u003cspan class=\"filename\"\u003e{{this.file}}\u003c/span\u003e\n        \u003cinput type=\"hidden\" class=\"hidden_input\" name=\"{{this.key}}\" value=\"{{this.attachment_id}}\" /\u003e\n        \u003cinput type=\"hidden\" class=\"hidden_input\" name=\"{{this.key}}\" value=\"{{this.url}}\" /\u003e\n        \u003cinput type=\"hidden\" class=\"hidden_input\" name=\"{{this.key}}\" value=\"{{this.file}}\" /\u003e\n        \u003cinput type=\"hidden\" class=\"hidden_input\" name=\"{{this.key}}\" value=\"{{this.comment_id}}\" /\u003e\n        \u003cinput type=\"hidden\" class=\"hidden_input\" name=\"{{this.key}}\" value=\"{{this.type}}\" /\u003e\n      \u003c/li\u003e\n      {{/each}}\n    \u003c/ul\u003e\n  \u003c/div\u003e\n    \u003cspan class=\"breakline\"\u003e\u003c/span\u003e\n    \u003cbutton id=\"attachLeave\" class=\"AttachLeave btn\" \u003eGo Back\u003c/button\u003e\n    \u003cbutton id=\"attachConfirm\" class=\"AttachConfirm btn\" \u003eConfirm Redaction\u003c/button\u003e\n\n\n\u003c!--Modal for confirming text redactions --\u003e\n\u003cdiv class=\"modal hide fade attach_redact\" tabindex=\"-1\" role=\"dialog\" aria-labelledby=\"myModalLabel\" aria-hidden=\"true\"\u003e\n  \u003cdiv class=\"modal-header\"\u003e\n    \u003cbutton type=\"button\" class=\"close\" data-dismiss=\"modal\" aria-hidden=\"true\"\u003e×\u003c/button\u003e\n    \u003ch3 class=\"my_modal_label\"\u003eConfirm Your Redaction\u003c/h3\u003e\n  \u003c/div\u003e\n  \u003cdiv class=\"modal-body\"\u003e\n    \u003cp\u003eDo you wish to redact the following attachments? \u003cspan class=\"tinyNote\"\u003e(Note: This will replace each occurance of the below attachment with an empty text file)\u003c/span\u003e\u003c/p\u003e\n    \u003cdiv class=\"attachPresenter\"\u003e\n\n    \u003c/div\u003e\n  \u003c/div\u003e\n  \u003cdiv class=\"modal-footer\"\u003e\n    \u003cbutton class=\"btn\" data-dismiss=\"modal\" aria-hidden=\"true\"\u003eCancel\u003c/button\u003e\n    \u003cbutton class=\"btn btn-primary save_attach_redact\" aria-hidden=\"true\"\u003eYes, Redact The Above Attachment(s)\u003c/button\u003e\n  \u003c/div\u003e\n\u003c/div\u003e\n\u003c!--END attachment confirmation modal --\u003e\n\n\u003c!--Modal for displaying no selection made --\u003e\n\u003cdiv class=\"modal hide fade attach_noselection\" tabindex=\"-1\" role=\"dialog\" aria-labelledby=\"myModalLabel\" aria-hidden=\"true\"\u003e\n  \u003cdiv class=\"modal-header\"\u003e\n    \u003cbutton type=\"button\" class=\"close\" data-dismiss=\"modal\" aria-hidden=\"true\"\u003e×\u003c/button\u003e\n    \u003ch3 class=\"my_modal_label\"\u003eOops!\u003c/h3\u003e\n  \u003c/div\u003e\n  \u003cdiv class=\"modal-body\"\u003e\n    \u003cp\u003eIt looks like you forgot to select an attachment. Please make sure your selection is checked and try again.\u003c/p\u003e\n\n  \u003c/div\u003e\n  \u003cdiv class=\"modal-footer\"\u003e\n    \u003cbutton class=\"btn\" data-dismiss=\"modal\" aria-hidden=\"true\"\u003eOkay\u003c/button\u003e\n  \u003c/div\u003e\n\u003c/div\u003e\n\u003c!--END no selection modal --\u003e\n\u003c/section\u003e","text_redact":"\u003csection data-main\u003e\n  \u003cdiv class=\"redactForm\"\u003e\n  {{#if can_delete}}\n    \u003ch4 class=\"redaction-type\"\u003eText Redaction\u003c/h4\u003e\n    \u003ctextarea placeholder=\"please paste a string of text you wish to redact...\"  id=\"redaction_string\" class=\"redaction_string\" name=\"redaction_string\"\u003e\u003c/textarea\u003e\n    {{/if}}\n    {{#if can_delete}}\n    \u003cbutton class='submit_text btn'\u003eRedact This!\u003c/button\u003e\n    {{else}}\n    \u003cspan class=\"warn_unable\"\u003eUnfortunately your role does not have access to redaction. Your administrator can change your role to allow 'ticket deletion' and enable this app\u003c/span\u003e\n    {{/if}}\n  \u003c/div\u003e\n  {{#if can_delete}}\n  \u003cspan class=\"breakline\"\u003e\u003c/span\u003e\n  \u003clabel id=\"attach_redact_label\" for=\"attach_redact\" class=\"button-label\" \u003eDo you want to redact an attachment?\u003c/label\u003e\n  \u003cbutton id=\"attach_redact\" class=\"attach_redact btn\" \u003eYes\u003c/button\u003e\n  {{/if}}\n\n  \u003c!--Modal for confirming text redactions --\u003e\n  \u003cdiv class=\"modal hide fade text_redact\" tabindex=\"-1\" role=\"dialog\" aria-labelledby=\"myModalLabel\" aria-hidden=\"true\"\u003e\n    \u003cdiv class=\"modal-header\"\u003e\n      \u003cbutton type=\"button\" class=\"close\" data-dismiss=\"modal\" aria-hidden=\"true\"\u003e×\u003c/button\u003e\n      \u003ch3 class=\"my_modal_label\"\u003eConfirm Your Redaction\u003c/h3\u003e\n    \u003c/div\u003e\n    \u003cdiv class=\"modal-body\"\u003e\n      \u003cp\u003eDo you wish to redact the below text?\u003c/p\u003e\n      \u003cp\u003e \u003cspan class=\"tiny_note\"\u003eNote: This will remove the below text, which occurs in \u003cspan class=\"num_actions\"\u003e{{total_actions}}\u003c/span\u003e comments on this ticket. This change is permanent and cannot be undone.\u003c/span\u003e\u003c/p\u003e\n      \u003cdiv class=\"string_presenter\"\u003e{{body}}\u003c/div\u003e\n    \u003c/div\u003e\n    \u003cdiv class=\"modal-footer\"\u003e\n      \u003cbutton class=\"btn\" data-dismiss=\"modal\" aria-hidden=\"true\"\u003eCancel\u003c/button\u003e\n      \u003cbutton class=\"btn btn-primary confirm_text_redaction\" aria-hidden=\"true\"\u003eYes, Redact The Above Text\u003c/button\u003e\n    \u003c/div\u003e\n  \u003c/div\u003e\n  \u003c!--END text confirmation modal --\u003e\n\u003c/section\u003e"},
      frameworkVersion: "1.0"
    });

  ZendeskApps["Ticket Redaction App"] = app;
}

    with( ZendeskApps.AppScope.create() ) {

  var source = (function () {

    var nextImage = "0";
    var authorEmail = "n/a";
    var authorName = "Unknown";
    var att = {item: []};
    var count_ajax = 0;


  return {
    events: {
        'app.activated':              'initiateApp',
        'reqGetAttachments.done':     'prepareList',
        'reqGetAttachments.fail':     'showError'
        
    },

    requests: {
        reqGetAttachments: function(ticketID) {
            return {
                url:        '/api/v2/tickets/' + ticketID + '/comments.json',
                type:       'GET',
                dataType:   'json'
                };
        },

        reqGetAuthor: function(authorID) {
            return {
                url:        '/api/v2/users/' + authorID + '.json',
                type:       'GET',
                dataType:   'json'
                };
        }
    },
      
    initiateApp: function() {
        this.switchTo('initiate');
        
        var ticket = this.ticket();
		var ticketID = ticket.id();

        this.ajax('reqGetAttachments', ticketID);
    },
      
    // Main function for creating list of attachments and populate object that is send to the template
    prepareList: function(data) {
        count_ajax = 0;                     // Used for counting the number of times reqGetAuthor has been called
        att = {                             // The object storing data send to the template list_attachments
            item: []
        };
        var x=0;
        var y=0;
        var i=0;
        var z=0;
        var q=0;
        var total = data.comments.length;   // Number of comments in ticket
        var isImage = false;                // Used to identify if an attachment is an image file
        var date_time = "";
        var ct = "";                        // Used for content type of the attachment
        var icon = "";                      // Used for name of the icon file to represent the attachment
        var file_size = "";                 // Used for storing human readable string for file size
        var nextAttachmentID = 0;           // ID of the next attachment in the list, used for prev/next function
        var prevAttachmentID = 0;           // ID of the previous attachment in the list, used for prev/next function
        var attachmentListLength = 0;       // Used for storing the number of attachments
        var firstAttachment = false;        // Set to true if the attachment is the first attachment on the ticket
        var lastAttachment = false;         // Set to true if the attachment is the last/latest attachment on the ticekt
        
        // Creating list of attachmentIDs used for prev/next function in lightbox
        // We also use this loop to check if there is actually any attachments on the ticket
        var attachmentList = [];
        for(; i < total; i++) {
            q=0;
            for(; q < data['comments'][i]['attachments'].length; q++) {
                attachmentList[z] = data['comments'][i]['attachments'][q].id;  
                z++;
            }
        }
        
        // If there is no attachments in the ticket
        if (z === 0 ) {
            this.switchTo('no_attachments');
        // Else, if there is attachments in the ticket
        } else {
            i=0;
            // Loop through each comment in the ticket
            for(; i < total; i++) {

                // If the ticekt comment got one or more attachments
                if (data['comments'][i]['attachments'].length > 0) {
                    y=0;

                    // Loop through each attachment in the comment
                    for(; y < data['comments'][i]['attachments'].length; y++) {

                        // Call function for getting the comments author name and email
                        this.funcGetAuthor(data['comments'][i].author_id, x, z);

                        isImage = false;    
                        
                        date_time = moment(data['comments'][i].created_at).format('LLL');

                        // Get content type of attachment
                        ct = data['comments'][i]['attachments'][y].content_type;
                        
                        // Based on the content type of the attachment, assign a file icon
                        // Archives
                        if (ct == 'application/x-zip-compressed') {
                            icon = 'icon_zip.png';
                        } else if (ct == 'application/x-rar') {
                            icon = 'icon_rar.png';
                        // Image files
                        } else if (ct == 'image/jpeg') {
                            icon = 'icon_jpg.png';
                            isImage = true;
                        } else if (ct == 'image/png') {
                            icon = 'icon_png.png';
                            isImage = true;
                        } else if (ct == 'image/gif') {
                            icon = 'icon_gif.png';
                            isImage = true;
                        } else if (ct == 'image/bmp') {
                            icon = 'icon_bmp.png';
                            isImage = true;
                        // Documents
                        } else if (ct == 'text/plain') {
                            icon = 'icon_txt.png';
                        } else if (ct == 'application/pdf') {
                            icon = 'icon_pdf.png';
                        } else if (ct == 'application/x-php') {
                            icon = 'icon_php.png';
                        } else if (ct == 'application/msword') {
                            icon = 'icon_word.png';
                        } else if (ct == 'application/vnd.ms-excel') {
                            icon = 'icon_xls.png';
                        } else if (ct == 'text/csv') {
                            icon = 'icon_csv.png';
                        // Video files
                        } else if (ct == 'application/x-dvi') {
                            icon = 'icon_video.png';
                        } else if (ct == 'video/x-msvideo') {
                            icon = 'icon_video.png';
                        } else if (ct == 'video/mp4') {
                            icon = 'icon_mp4.png';
                        // Other file types
                        } else if (ct == 'application/x-msdownload') {
                            icon = 'icon_exe.png';
                        } else {
                            icon = 'icon_unknown2.png';
                        }

                        file_size = formatBytes(data['comments'][i]['attachments'][y].size, 0);

                        // Find the attachment before and after the current attachment
                        nextAttachmentID = 0;
                        prevAttachmentID = 0;
                        lastAttachment = true;
                        firstAttachment = false;
                        attachmentListLength = attachmentList.length;
                        if (x+1 < attachmentListLength) {
                            nextAttachmentID = attachmentList[x+1];  
                            lastAttachment = false;
                            if (x === 0) {
                                firstAttachment = true;    
                            } else {
                                prevAttachmentID = attachmentList[x-1];   
                            }
                        } else {
                            prevAttachmentID = attachmentList[x-1];   
                        }

                        //Add details about the attachment to the object that is send to the template
                        att['item'][x] = {
                            id:                     data['comments'][i]['attachments'][y].id,
                            x:                      x,
                            comment_id:             data['comments'][i].id,
                            comment_author_id:      data['comments'][i].author_id,
                            comment_html:           data['comments'][i].html_body,
                            comment_author:         authorName,
                            comment_email:          authorEmail,
                            file_name:              data['comments'][i]['attachments'][y].file_name,
                            content_type:           data['comments'][i]['attachments'][y].content_type,
                            content_type_icon:      icon,
                            content_url:            data['comments'][i]['attachments'][y].content_url,
                            created_at:             date_time,
                            file_size:              file_size,
                            isImage:                isImage,
                            nextAttachment:         nextAttachmentID,
                            prevAttachment:         prevAttachmentID,
                            lastAttachment:         lastAttachment,
                            firstAttachment:        firstAttachment

                        };
                        x++;
                    }
                }
            }
        
        }
        
    },

    showError: function() {
        this.switchTo('error');
    },
      

    // Function for getting author email and name for a comment  
    funcGetAuthor: function(authorID, counter, total_attachments) {

        this.ajax('reqGetAuthor', authorID).then (
            function(data) {
                authorName = data.user.name;
                authorEmail = data.user.email;
                att['item'][counter]['comment_author'] = authorName;
                att['item'][counter]['comment_email'] = authorEmail;
             
                count_ajax++;
                
                if (count_ajax == total_attachments) {
                    this.switchTo('list_attachments', att);
                    
                }
                },
           //If error
            function() {
                count_ajax++;
                
                if (count_ajax == total_attachments) {
                    this.switchTo('list_attachments', att);    
                }
                }
            ); 
    }
  };
    
    // Calculate human readable file size value
    function formatBytes(bytes,decimals) {
        if(bytes === 0) return '0 Byte';
        var k = 1000; 
        var dm = decimals + 1 || 3;
        var sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
        var i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + sizes[i];
    }

}());
;
}
var app = ZendeskApps.defineApp(source)
  .reopenClass({"location":{"zendesk":{"ticket_sidebar":"_legacy"}},"noTemplate":false,"singleInstall":false})
  .reopen({
    appName: "Attachment List",
    appVersion: "1.1",
    assetUrlPrefix: "/api/v2/apps/84814/assets/",
    appClassName: "app-84814",
    author: {
      name: "SlopeTracker",
      email: "support@slopetracker.net"
    },
    translations: {"app":{}},
    templates: {"error":"###########\u003cbr\u003e\r\n## ERROR ##\u003cbr\u003e\r\n###########\u003cbr\u003e","initiate":"\u003cimg src=\"{{assetURL \"ajax-loader.gif\"}}\" style=\"padding-left: 10px; margin-top: 5px;\"/\u003e Please wait, getting attachments....","layout":"\u003cstyle\u003e\n.app-84814 header .logo {\n  background-image: url(\"/api/v2/apps/84814/assets/logo-small.png\"); }\n.app-84814 .modal {\n  width: 700px; }\n\u003c/style\u003e\n\u003cheader\u003e\n  \u003cspan class=\"logo\"\u003e\u003c/span\u003e\n  \u003ch3\u003e{{setting \"name\"}}\u003c/h3\u003e\n\u003c/header\u003e\n\u003csection data-main\u003e\u003c/section\u003e\n\u003cfooter\u003e\n\n\u003c/footer\u003e","list_attachments":"\u003ctable class=\"table\"\u003e\r\n{{#each item}}\r\n    \u003ctr title=\"File Name: {{file_name}}\u0026#013;File type: {{content_type}}\u0026#013;Added by: {{comment_author}}\"\u003e\r\n    \u003ctd\u003e\u003ca data-toggle=\"modal\" data-target=\".my_modal_{{id}}\"\u003e\u003cimg src=\"{{assetURL \"\"}}{{content_type_icon}}\" border=\"0\"\u003e\u003c/a\u003e\u003c/td\u003e\r\n    \u003ctd valign=\"middle\"\u003e{{file_size}}\u003c/td\u003e\r\n    \u003ctd\u003e{{created_at}}\u003c/td\u003e\r\n    \u003ctd\u003e\u003ci class=\"icon-info-sign\" title=\"Show ticket comment the attachment belongs to\" data-toggle=\"modal\" data-target=\".my_modal_comment_{{id}}\"\u003e\u003c/i\u003e\u003c/td\u003e\r\n    \u003c/tr\u003e\r\n    \r\n    \r\n    \u003cdiv class=\"modal hide fade my_modal_{{id}}\" tabindex=\"-1\" role=\"dialog\" aria-labelledby=\"myModalLabel\" aria-hidden=\"true\"\u003e\r\n        \u003cdiv class=\"modal-header\"\u003e\r\n            \u003cbutton type=\"button\" class=\"close\" data-dismiss=\"modal\" aria-hidden=\"true\"\u003ex\u003c/button\u003e\r\n            \r\n            \u003ch3 class=\"my_modal_label\"\u003e{{file_name}} ({{file_size}})\u003c/h3\u003e\r\n            Added by {{comment_author}} ({{comment_email}}) at {{created_at}}\r\n            \r\n        \u003c/div\u003e\r\n        \u003cdiv class=\"modal-body\"\u003e\r\n            {{#if isImage}}\r\n                \u003cp\u003e\u003cimg src=\"{{content_url}}\" class=\"img-responsive\"\u003e\u003c/p\u003e\r\n            {{else}}\r\n                \u003cp\u003e\r\n                Attachment type: {{content_type}}\u003cbr\u003e\r\n                file size: {{file_size}}\u003cbr\u003e\r\n                \r\n                \u003c/p\u003e\r\n            {{/if}}\r\n            \r\n        \u003c/div\u003e\r\n        \u003cdiv class=\"modal-footer\"\u003e\r\n            \u003ca href=\"{{content_url}}\" target=\"_new\" class=\"btn pull-left\"\u003eDownload \u003ci class=\"icon-download\"\u003e\u003c/i\u003e\u003c/a\u003e\r\n            {{#unless firstAttachment}}\r\n                \u003cbutton class=\"btn btn-primary\" data-toggle=\"modal\" data-target=\".my_modal_{{prevAttachment}}\" data-dismiss=\"modal\" aria-hidden=\"true\"\u003e\u003ci class=\"icon-arrow-left icon-white\"\u003e\u003c/i\u003e Previous\u003c/button\u003e\r\n            {{/unless}}\r\n            {{#unless lastAttachment}}\r\n                \u003cbutton class=\"btn btn-primary\" data-toggle=\"modal\" data-target=\".my_modal_{{nextAttachment}}\" data-dismiss=\"modal\" aria-hidden=\"true\"\u003eNext \u003ci class=\"icon-arrow-right icon-white\"\u003e\u003c/i\u003e\u003c/button\u003e\r\n                \r\n            {{/unless}}\r\n            \r\n            \r\n        \u003c/div\u003e\r\n    \u003c/div\u003e\r\n    \r\n    \r\n    \u003cdiv class=\"modal hide fade my_modal_comment_{{id}}\" tabindex=\"-1\" role=\"dialog\" aria-labelledby=\"myModalLabel\" aria-hidden=\"true\"\u003e\r\n        \u003cdiv class=\"modal-header\"\u003e\r\n            \u003cbutton type=\"button\" class=\"close\" data-dismiss=\"modal\" aria-hidden=\"true\"\u003ex\u003c/button\u003e\r\n            Comment by {{comment_author}} ({{comment_email}}) at {{created_at}}\r\n        \u003c/div\u003e\r\n        \u003cdiv class=\"modal-body\"\u003e\r\n            \u003cp\u003e{{{comment_html}}}\u003c/p\u003e\r\n        \u003c/div\u003e\r\n        \u003cdiv class=\"modal-footer\"\u003e\r\n            \u003cbutton class=\"btn\" data-dismiss=\"modal\" aria-hidden=\"true\"\u003eClose\u003c/button\u003e\r\n        \u003c/div\u003e\r\n    \u003c/div\u003e\r\n\r\n{{/each}}\r\n\u003c/table\u003e\r\n\r\n\r\n","modal":"\u003c!-- modal.hdbs --\u003e\r\n\u003cdiv class=\"modal hide fade my_modal\" tabindex=\"-1\" role=\"dialog\" aria-labelledby=\"myModalLabel\" aria-hidden=\"true\"\u003e\r\n  \u003cdiv class=\"modal-header\"\u003e\r\n    \u003cbutton type=\"button\" class=\"close\" data-dismiss=\"modal\" aria-hidden=\"true\"\u003e×\u003c/button\u003e\r\n    \u003ch3 class=\"my_modal_label\"\u003e{{header}}\u003c/h3\u003e\r\n  \u003c/div\u003e\r\n  \u003cdiv class=\"modal-body\"\u003e\r\n    \u003cp\u003e{{body}}\u003c/p\u003e\r\n  \u003c/div\u003e\r\n  \u003cdiv class=\"modal-footer\"\u003e\r\n    \u003cbutton class=\"btn\" data-dismiss=\"modal\" aria-hidden=\"true\"\u003eClose lightbox\u003c/button\u003e\r\n    \u003cbutton class=\"btn btn-primary save_button\" data-dismiss=\"modal\" aria-hidden=\"true\"\u003eSave content\u003c/button\u003e\r\n  \u003c/div\u003e\r\n\u003c/div\u003e\r\n\u003chr\u003e\r\nTesting\r\n\r\n","no_attachments":"Ticket got no attachments...."},
    frameworkVersion: "1.0"
  });

ZendeskApps["Attachment List"] = app;

    with( ZendeskApps.AppScope.create() ) {

  var source = (function() {
  return {
    fieldsOnError: [],
    requests: {
      fetchUser: function() {
        return {
          url: helpers.fmt('/api/v2/users/%@.json?include=groups,organizations',
                           this.currentUser().id()),
          dataType: 'json',
          type: 'GET'
        };
      }
    },

    events: {
      'app.activated'           : 'onAppActivated',
      'fetchUser.done'          : 'onFetchUserDone',
      'ticket.save'             : 'onTicketSave',
      '*.changed'               : 'onFieldChanged'
    },

    onAppActivated: function(app) {
      this.ajax('fetchUser');
    },

    onFetchUserDone: function(data) {
      this.data = data;

      this.onFieldChanged();
    },

    onTicketSave: function() {
      var fieldsOnError = this.validateRequiredFields();

      if (!_.isEmpty(fieldsOnError)) {
        return this.I18n.t('invalid_fields', { fields: this.fieldsLabel(fieldsOnError).join(',') });
      }

      return true;
    },

    onFieldChanged: function() {
      if (!this.data) return;

      _.defer(this.handleFields.bind(this));
    },

    handleFields: function() {
      this.handleHiddenFields();
      this.handleReadOnlyFields();
    },

    validateRequiredFields: function() {
      return _.filter(this.requiredFields(), function(field) {
        return !this.fieldIsValid(field);
      }, this);
    },

    handleHiddenFields: function() {
      this.hiddenFields().forEach(function(field) {
        this.applyActionOnField(field, 'hide');
      }, this);
    },

    handleReadOnlyFields: function() {
      this.readOnlyFields().forEach(function(field) {
        this.applyActionOnField(field, 'disable');
      }, this);
    },

    applyActionOnField: function(field, action) {
      var splittedField = field.split('.'),
      fieldName = splittedField[0],
      optionValue = splittedField[1],
      ticketField = this.ticketFields(fieldName);

      if (!ticketField) { return false; }

      if (optionValue && ticketField.options()) {
        var option = _.find(ticketField.options(), function(opt) {
          return opt.value() == optionValue;
        });

        if (option) {
          option[action]();
        }
      } else {
        ticketField[action]();
      }
    },

    requiredFields: _.memoize(function() {
      return this.fields('required_fields');
    }),

    hiddenFields: _.memoize(function() {
      return this.fields('hidden_fields');
    }),

    readOnlyFields: _.memoize(function() {
      return this.fields('readonly_fields');
    }),

    fields: function(type) {
      if (this.currentUserIsWithlistedFor(type))
        return [];
      return this.splittedSetting(type);
    },

    currentUserIsWithlistedFor: function(type) {
      return _.any([
        this.currentUserIsWhitelistedByTagFor(type),
        this.currentUserIsWhitelistedByGroupFor(type),
        this.currentUserIsWhitelistedByOrganizationFor(type)
      ]);
    },

    currentUserIsWhitelistedByTagFor: function(type) {
      var tags = this.splittedSetting(type + '_whitelist_tags');

      return this.deepContains(this.data.user.tags, tags);
    },

    currentUserIsWhitelistedByGroupFor: function(type) {
      var group_ids = this.splittedSetting(type + '_whitelist_group_ids'),
          current_group_ids = _.map(this.data.groups, function(group) {
            return String(group.id);
          });

      return this.deepContains(current_group_ids, group_ids);
    },

    currentUserIsWhitelistedByOrganizationFor: function(type) {
      var organization_ids = this.splittedSetting(type + '_whitelist_organization_ids'),
          current_organization_ids = _.map(this.data.organizations, function(organization) {
            return String(organization.id);
          });

      return this.deepContains(current_organization_ids, organization_ids);
    },

    //list and values should be Arrays
    deepContains: function(list, values) {
      var flattened_contains = _.inject(values, function(memo, value) {
        memo.push(_.contains(list, value));
        return memo;
      }, []);

      return _.any(flattened_contains);
    },

    splittedSetting: function(name) {
      return _.compact((this.setting(name) || '').split(','));
    },

    fieldIsValid: function(field) {
      var value = _.clone(this.containerContext().ticket[field]);

      // field is present and is empty
      if (this.ticketFields(field) &&
          (_.isEmpty(value) || value == '-' ||
            (field == "type" && value == "ticket") ||
              (field == "requester" && _.isEmpty(value.email)))) {
        return false;
      }

      return true;
    },

    fieldsLabel: function(fields) {
      return _.map(fields, function(field) {
        var tf = this.ticketFields(field),
            label = this.ticketFields(field) && this.ticketFields(field).label();

        if (label) {
          return label;
        } else {
          return field;
        }
      }, this);
    }
  };
}());
;
}
var app = ZendeskApps.defineApp(source)
  .reopenClass({"location":{"zendesk":{"ticket_sidebar":"_legacy","new_ticket_sidebar":"_legacy"}},"noTemplate":true,"singleInstall":false,"signedUrls":false})
  .reopen({
    appName: "Ticket Field Manager",
    appVersion: "1.4",
    assetUrlPrefix: "https://97112.apps.zdusercontent.com/97112/assets/1473279464-d9c967847cf679226605046b02c2dd66/",
    appClassName: "app-97112",
    author: {
      name: "Zendesk Services",
      email: "services@zendesk.com"
    },
    translations: {"app":{"description":"Ticket Field Manager","name":"Ticket Field Manager","parameters":{"required_fields":{"label":"Required Fields","helpText":"List of required ticket fields separated by commas. Example: status,custom_field_1234567"},"required_fields_whitelist_tags":{"label":"Required Fields whitelist tags","helpText":"List of tags separated by commas. Example: admin,super_agent"},"required_fields_whitelist_group_ids":{"label":"Required Fields whitelist groups","helpText":"List of group ids separated by commas. Example: 231231321,34345456"},"required_fields_whitelist_organization_ids":{"label":"Required Fields whitelist organizations","helpText":"List of organization ids separated by commas. Example: 231231321,34345456"},"hidden_fields":{"label":"Hidden Fields","helpText":"List of hidden ticket fields separated by commas. Example: status,custom_field_1234567"},"hidden_fields_whitelist_tags":{"label":"Hidden Fields whitelist tags","helpText":"List of tags separated by commas. Example: admin,super_agent"},"hidden_fields_whitelist_group_ids":{"label":"Hidden Fields whitelist groups","helpText":"List of group ids separated by commas. Example: 231231321,34345456"},"hidden_fields_whitelist_organization_ids":{"label":"Hidden Fields whitelist organizations","helpText":"List of organization ids separated by commas. Example: 231231321,34345456"},"readonly_fields":{"label":"Readonly Fields","helpText":"List of read only ticket fields separated by commas. Example: status,custom_field_1234567"},"readonly_fields_whitelist_tags":{"label":"Readonly Fields whitelist tags","helpText":"List of tags separated by commas. Example: admin,super_agent"},"readonly_fields_whitelist_group_ids":{"label":"Readonly Fields whitelist groups","helpText":"List of group ids separated by commas. Example: 231231321,34345456"},"readonly_fields_whitelist_organization_ids":{"label":"Readonly Fields whitelist organizations","helpText":"List of organization ids separated by commas. Example: 231231321,34345456"}}},"invalid_fields":"The following fields cannot be empty: \u003cstrong\u003e{{fields}}\u003c/strong\u003e"},
    templates: {},
    frameworkVersion: "1.0"
  });

ZendeskApps["Ticket Field Manager"] = app;

    with( ZendeskApps.AppScope.create() ) {
  require.modules = {
      "boolean_state.js": function(exports, require, module) {
        // Boolean state with observers
function BooleanState(app, trueCallback, falseCallback) {
  this.app = app;
  this.trueCallback = trueCallback;
  this.falseCallback = falseCallback;
  this.value = false;
}

BooleanState.prototype = {
  set: function() {
    this.app.trigger(this.trueCallback);
  },

  clear: function() {
    this.app.trigger(this.falseCallback);
  }
};

module.exports = BooleanState;

      },
      "change_event.js": function(exports, require, module) {
        module.exports = function dispatchChangeEvent(el) {
  var event;
  if (document.createEvent) {
    event = document.createEvent('HTMLEvents');
    event.initEvent('change', true, true);
    el.dispatchEvent(event);
  } else {
    event = document.createEventObject();
    event.eventType = 'change';
    el.fireEvent('on' + event.eventType, event);
  }
};

      },
      "condition_checker.js": function(exports, require, module) {
        module.exports = function(_) {
    // satisfiesTargetCondition(Condition, [Field]) -> boolean
  function satisfiesTargetCondition(targetCondition, fields) {
    return !!_.findWhere(fields, {
      field: targetCondition.field,
      value: targetCondition.value
    });
  }

  // findParentCondition(Condition, [Condition]) -> Condition
  function findParentCondition(targetCondition, conditions) {
    return _.find(conditions, function(condition) {
      return _.contains(condition.select, targetCondition.field);
    });
  }

  // findAllParentConditions(Condition, [Condition]) -> [Condition]
  function findAllParentConditions(targetCondition, conditions) {
    return _.filter(conditions, function(condition) {
      return _.contains(condition.select, targetCondition.field);
    });
  }

  return {
    // type Id = number
    // type Field = { id: Id, value: any }
    // type Condition = {
    //   id: Id,
    //   expectedValue: any,
    //   children: [Id],
    //   requireds: [Id]
    // }

    // satisfiesCondition(Condition, [Condition], [Field]) -> boolean
    // A child can only ever be assigned to a single parent field
    // This means other parents cannot use the assigned child in a condition
    // However a parent is able to have multiple children that are not already assigned
    satisfiesCondition: function(targetCondition, conditions, fields) {
      var parentConditions = findAllParentConditions(targetCondition, conditions),
          satisfiesParentCondition = true;

      if (parentConditions.length) {
        var matchingParentCondition = _.find(parentConditions, function(condition) {
          return satisfiesTargetCondition(condition, fields);
        });
        
        if (!matchingParentCondition) { return false; }

        satisfiesParentCondition = this.satisfiesCondition(matchingParentCondition, conditions, fields);
      }

      return satisfiesParentCondition &&
        satisfiesTargetCondition(targetCondition, fields);
    },

    // allSatisfiedConditions([Condition], [Field]) -> [Condition]
    allSatisfiedConditions: function(conditions, fields) {
      return _.filter(conditions, function(condition) {
        return this.satisfiesCondition(condition, conditions, fields);
      }, this);
    },

    // requiredFieldIds([Condition]) -> [Id]
    requiredFieldIds: function(conditions) {
      return _.uniq(_.flatten(_.map(conditions, function(cond) {
        return cond.requireds;
      })));
    },

    // fieldIdsToShow([Condition], [Field]) -> [Id]
    fieldIdsToShow: function(conditions, fields) {
      return _.uniq(_.flatten(_.pluck(
        this.allSatisfiedConditions(conditions, fields), 'select')));
    },

    // allRequiredConditions([Condition]) -> [Condition]
    allRequiredConditions: function(conditions) {
      return _.filter(conditions, function(cond) {
        return cond.requireds.length > 0;
      });
    },

    // isFieldAssignedAsParent(Id, Condition, [Condition]) -> boolean
    isFieldAssignedAsParent: function(fieldId, fieldCondition, conditions) {
      var parentCondition = findParentCondition(fieldCondition, conditions);

      if (!parentCondition) { return false; }

      if (parentCondition.field === fieldId) { return true; }

      return this.isFieldAssignedAsParent(fieldId, parentCondition, conditions);
    },

    getValidConditions: function(conditions) {
      for (var i = 0; i < conditions.length; i++) {
        if (this.isFieldAssignedAsParent(conditions[i].field, conditions[i], conditions)) {
          // Reset for isFieldAssignedAsParent()
          // Performed to allow the last conflicting condition to be valid
          console.warn("Conditional fields app: rule conflict on field id " + conditions[i].field);
          conditions.splice(i, 1);
          i--; // Reduce index due to splicing, otherwise it will process undefined data
        }
      }
      return conditions;
    },

    getAllValidConditions: function(conditions) {
      if (!conditions || !conditions.length) { return []; }
      var conditionsByFormId = _.groupBy(conditions, 'formId');

      _.each(conditionsByFormId, function(conditions) {
        this.getValidConditions(conditions);
      }, this);
      return _.flatten(_.toArray(conditionsByFormId));
    }
  };
};

      },
      "partial_renderer.js": function(exports, require, module) {
        // Partial renderer
module.exports = function(renderingFunction, jqSelector, defaultState, app) {
  var func = _.bind(renderingFunction, app),
      data,
      state;

  var SpecializedPartialRenderer = function() {
    this.data = null;
    this.state = null;
  };

  SpecializedPartialRenderer.prototype.render = function(data, state) {
    this.state = this.state || defaultState;
    if (typeof data !== "undefined") {
      this.data = data;
    }
    if (typeof state !== "undefined") {
      this.state = state;
    }
    var html = func(this.data, this.state);
    app.$(jqSelector).html(html);
  };

  return new SpecializedPartialRenderer();
};

      },
      "redrawer.js": function(exports, require, module) {
        var ConditionChecker = require("condition_checker")(_);

function Redrawer() {}

Redrawer.prototype = {
  fields: function(app) {
    var fields = app.getRestrictedFields();
    var originalFields = fields;
    if (app.SELECTION.field !== null) {
      fields[app.SELECTION.field].selected = true;
    }

    _.each(app.getRestrictedRules(), function(rule) {
      fields[rule.field].assigned = true;
    });

    // filter out fields with no defined possible values
    var TYPES_BLACKLIST = ['regexp', 'decimal', 'integer'];
    fields = _.toArray(_.reject(fields, function(field) {
      return _.contains(TYPES_BLACKLIST, field.type);
    }));

    var usedFields = _.select(fields, function(field) {
      return field.assigned;
    });
    var freeFields = _.reject(fields, function(field) {
      return field.assigned;
    });

    var html = app.renderTemplate('fields', {
      usedFields: usedFields,
      freeFields: freeFields
    });
    app.$('.fields').html(html);

    // revert the state
    app.cleanUpAttributes(originalFields, ['selected', 'assigned']);
  },

  selection: function(app) {
    var fields = [];
    var originalFields = [];

    if (app.SELECTION.field && app.SELECTION.value) {
      fields = _.toArray(app.getRestrictedFields());
      fields = _.reject(fields, function(field) {
        return field.type === 'group';
      });
      originalFields = fields;

      // map each target field to the field it depends on.
      var fieldsUses = {};
      _.each(app.getRestrictedRules(), function(rule) {
        _.each(rule.select, function(target) {
          fieldsUses[target] = rule.field;
        });
      });

      var currentRule = app.getCurrentRule();

      fields = _.map(fields, (function(field) {
        // mark selected fields
        field.selected = _.contains(app.SELECTION.select, field.id);

        // mark un-selectable fields, so as they are not used to create faulty rules.
        field.unselectable = !app.setting('disable_conflicts_prevention') && !(typeof fieldsUses[field.id] === "undefined" ||
        fieldsUses[field.id] === app.SELECTION.field);

        field.required = field.systemRequired;
        if (currentRule) {
          field.required = field.systemRequired || _.contains(currentRule.requireds, field.id);
        }

        if (field.unselectable) { return field; }
        var allRules = app.allRulesForCurrentForm();
        if (!allRules.length) { return field; }

        var fieldCondition = { field: app.SELECTION.field };
        var conditions = allRules;

        if (ConditionChecker.isFieldAssignedAsParent(field.id, fieldCondition, conditions)) {
          field.unselectable = true;
        }

        return field;
      }));
    }

    var selectedCount = app.countByAttr(fields, 'selected');

    // hide the base field, so as it can't interact on itself
    fields = _.reject(fields, function(field) {
      return field.id === app.SELECTION.field;
    });

    var selectableFields = _.filter(fields, function(field) {
      return !field.unselectable;
    });
    var unselectableFields = _.filter(fields, function(field) {
      return field.unselectable;
    });

    var html = app.renderTemplate('select_fields', {
      selectableFields: selectableFields,
      unselectableFields: unselectableFields,
      total: selectableFields.length + unselectableFields.length,
      hasSelected: selectedCount > 0
    });
    app.$('.selected').html(html);

    app.$('.selected_count').html(selectedCount);

    // enable tooltips
    app.$('.selected span[data-toggle="tooltip"]').tooltip({
      placement: 'left'
    });

    // revert the state
    app.cleanUpAttributes(originalFields, ['selected']);
  },

  values: function(app) {
    var values = [];
    var originalValues = [];

    if (app.SELECTION.field) {
      values = app.storage.fields[app.SELECTION.field].values;
      originalValues = values;
      var rvalues = _.pluck(_.groupBy(app.getRestrictedRules(), 'field')[app.SELECTION.field], 'value');
      if (app.isFieldText(app.SELECTION.field)) {
        values = _.map(rvalues, function(rv) {
          return {name: rv, value: rv};
        });
      }
      values = _.map(values, (function(value) {
        value.selected = (value.value === app.SELECTION.value);
        value.assigned = _.contains(rvalues, value.value);
        return value;
      }).bind(app));
    }

    values = _.map(values, function(value) {
      value.name = app.removeDoubleColon(value.name);
      return value;
    });

    var html = app.renderTemplate('values', {values: values});
    app.$('.values').html(html);
    app.$('.values-text-input').toggle(app.isFieldText(app.SELECTION.field));

    // revert the state
    app.cleanUpAttributes(originalValues, ['selected', 'assigned']);
  }
};

module.exports = Redrawer;

      },
      "selection.js": function(exports, require, module) {
        // Object builder to provide a wrapper around the current selection.
// The 'app' parameter is the app itself. It is used to propagate changes
// and fire events.
function Selection(app) {
  this.app = app;
  this.initialize();
}

Selection.prototype = {
  initialize: function() {
    this.field = null;
    this.value = null;
    this.select = [];
  },

  _trigger: function(name, trigger) {
    if (trigger || trigger === trigger) {
      this.app.trigger(name);
    }
  },

  setField: function(field, trigger) {
    this.field = parseInt(field, 10);
    this._trigger('fieldChanged', trigger);
  },

  setValue: function(value, trigger) {
    this.value = value;
    this._trigger('valueChanged', trigger);
  },

  toggleSelect: function(id, trigger) {
    if (_.contains(this.select, id)) {
      this.select = _.reject(this.select,
        function(fid) {
          return fid === id;
        });
    }
    else {
      this.select = _.uniq(this.select.concat([id]));
    }
    this._trigger('selectionChanged', trigger);
  },

  setSelect: function(select, trigger) {
    this.select = select;
    this._trigger('selectionChanged', trigger);
  },

  getRule: function() {
    return {
      field: this.field,
      value: this.value,
      select: this.select
    };
  },

  setFromRule: function(rule) {
    this.setField(rule.field);
    this.setValue(rule.value);
    this.setSelect(rule.select);
  }
};

module.exports = Selection;

      },
    eom: undefined
  };

  var source = (function() {
  var ConditionChecker = require("condition_checker")(_),
       partialRenderer = require("partial_renderer"),
          BooleanState = require("boolean_state"),
              Redrawer = require("redrawer"),
             Selection = require("selection");

  return {
    // Used instead of browser's local stroage for performance reasons.
    storage: null,

    // Store the current mode (agent or endUser)
    currentMode: "agent",

    // Events that should be ignored
    ignoredEvents: {},

    // Store the ID of the current ticket form.
    // This variable is initialized during app activation.
    currentTicketForm: undefined,

    // Store the original labels of ticket fields.
    originalLabels: null,

    // Store the state of the current rule selection.
    // This variable is initialized during app activation.
    SELECTION: null,

    // Has any change made to the rules?
    // This is a BooleanState, initialized during app activation.
    DIRTY: null,

    // Initial copy of the rules, to allow undo / canceling.
    OLD_RULES: null,

    // New rule fields blacklist.
    // Those fields types are listed by ticket Ticket Fields API, but should not
    // be used as a trigger or target for a new rule.
    BLACKLIST: ["assignee", "subject", "description", "ccs", "ticketsharing"],

    // Protected fields blacklist.
    // Those fields must not be impacted by CFA because they have a defined
    // behaviour in Zendesk.
    PROTECTED_FIELDS: ['due_date', 'problem', 'ticket_form_id'],

    // Rules are splitted in several settings fields to allow users with a large
    // rule set to use CFA.
    RULES_FIELDS_SIZE: 63000,
    RULES_FIELDS_NUMBER: 2,

    defaultState: 'loading',

    events: {
      // App
      'app.created': 'onAppCreated',
      'app.activated': 'onAppActivation',
      'app.deactivated': 'onAppDeactivation',
      'pane.activated': 'onPaneActivation',
      '*.changed': 'fieldsChanged',

      // Requests

      // UI
      'click .main .field': 'onFieldClick',
      'click .main .value': 'onValueClick',
      'click .selectedField': 'onSelectedFieldClick',
      'click .cancel': 'onCancelClick',
      'click .save': 'onSaveClick',
      'click .deleteRule': 'onRuleDeleteClick',
      'click .deleteAll': 'onDeleteAllClick',
      'click #deleteAllModal .yes': 'onConfirmDeleteAllClick',
      'click #deleteOneModal .yes': 'onRuleDeleteConfirmClick',
      'click #requiredWarningModal .yes': 'onConfirmRulesSave',
      'click .generateSnippet': 'onGenerateSnippetClick',
      'zd_ui_change .formSelect': 'onTicketFormChange',
      'click .collapse_menu': 'onCollapseMenuClick',
      'click .ruleItem': 'onRuleItemClick',
      'click .clearSearch': 'onClearSearchClick',
      'hover .rule .value': 'onRuleMouseHover',
      'zd_ui_change .modeSwitch': 'onModeSwitchChange',
      'click .copyRules': 'onCopyRulesClick',
      'click .newSetRules': 'onNewSetRulesClick',
      'keyup .values-text-input': 'onTextValueInput',
      'click .enableRequired': 'onEnableRequired',
      'click .cancelRequired': 'onCancelRequired',
      'click .disableRequired': 'onDisableRequired',

      // Data binding
      'fieldChanged': 'onFieldChange',
      'selectionChanged': 'onSelectionChanged',
      'valueChanged': 'onValueChanged',
      'rulesDirty': 'onRulesDirty',
      'rulesClean': 'onRulesClean',
      'rulesChanged': 'onRulesChanged'
    },

    requests: {
      getPage: function(page) {
        return {
          type: 'GET',
          url: page
        };
      },

      getGroups: {
        type: 'GET',
        url: '/api/v2/groups/assignable.json'
      },

      getTicketFields: {
        type: 'GET',
        url: '/api/v2/ticket_fields.json'
      },

      getTicketForms: {
        type: 'GET',
        url: '/api/v2/ticket_forms.json'
      },

      saveRules: function(rulesString, notify) {
        if (notify || typeof notify === "undefined") {
          services.notify(this.I18n.t("notices.saved"));
        }
        var data = {
          'enabled': true,
          'settings': {}
        };
        for (var i = 0; i < this.RULES_FIELDS_NUMBER; i++) {
          // In order to upgrade smoothly, the first field does not have a suffix
          var key = (i === 0 ? this.rulesField : [this.rulesField, i].join('_'));
          data.settings[key] = rulesString.slice(i * this.RULES_FIELDS_SIZE, (i + 1) * this.RULES_FIELDS_SIZE);
          this.settings[key] = data.settings[key];
        }
        return {
          type: 'PUT',
          url: "/api/v2/apps/installations/%@.json".fmt(this.installationId()),
          dataType: 'json',
          data: data
        };
      }
    },


    // RENDERERS ===============================================================

    rulesRendering: function(rules, state) {
      var index = this.findIndexForSelection();
      // attach textual label to rules
      rules = _.map(this.getRestrictedRules(), (function(rule) {
        rule.valueText = this.removeDoubleColon(this.valueNameForRule(rule));
        rule.fieldsText = _.map(rule.select, this.nameForFieldId.bind(this)).join(', ');
        rule.selected = rule.index === index;
        return rule;
      }).bind(this));

      // group rules by fields
      var fields = _.map(this.toPairs(_.groupBy(rules, 'field')), (function(item) {
        return {
          id: item[0],
          name: this.storage.fields[item[0]].name,
          rules: item[1],
          collapsed: state.collapsed.indexOf(item[0]) !== -1,
          toCollapse: (state.collapsed.indexOf(item[0]) !== -1) !== (item[0] === state.toggleCollapsed)
        };
      }).bind(this));
      // sort rules
      fields = _.sortBy(fields, function(field) {
        return _.min(_.pluck(field.rules, 'creationDate'));
      });
      _.each(fields, function(field) {
        field.rules = _.sortBy(field.rules, 'creationDate');
      });

      // render the template
      var html = this.renderTemplate('rules', {
        fields: fields,
        count: rules.length
      });
      var generateSnippet = this.$('.generateSnippet');
      if (rules.length) {
        generateSnippet.show();
      }
      else {
        generateSnippet.hide();
      }

      _.defer((function() {
        if (state.toggleCollapsed) {
          var index = state.collapsed.indexOf(state.toggleCollapsed);
          var element = this.$(".rule[data-id=%@] ul".fmt(state.toggleCollapsed));
          if (index === -1) {
            state.collapsed.push(state.toggleCollapsed);
            element.slideDown();
          }
          else {
            state.collapsed.splice(index, 1);
            element.slideUp();
          }
          state.toggleCollapsed = null;
        }
      }).bind(this));

      return html;
    },

    // TOOLS ===================================================================

    // Implement the object() method of underscorejs, because 1.3.3 doesn't
    // include it. Simplified for our use.
    toObject: function(list) {
      if (list == null) return {};
      var result = {};
      for (var i = 0, l = list.length; i < l; i++) {
        result[list[i][0]] = list[i][1];
      }
      return result;
    },

    // Implement the pairs() method of underscorejs, because 1.3.3 doesn't
    // include it.
    toPairs: function(obj) {
      var pairs = [];
      for (var key in obj) if (_.has(obj, key)) pairs.push([key, obj[key]]);
      return pairs;
    },

    // Implement the partial() method of underscorejs, because 1.3.3 doesn't
    // include it.
    partial: function(func) {
      var args = Array.prototype.slice.call(arguments, 1);
      return function() {
        return func.apply(this,
          args.concat(Array.prototype.slice.call(arguments)));
      };
    },

    // Implement the countBy() method of underscorejs, because 1.3.3 doesn't
    // include it.
    countBy: function(list, func) {
      var count = 0;
      _.each(list, function(obj) {
        count += (func(obj) ? 1 : 0);
      });
      return count;
    },

    showSidebar: function() {
      this.switchTo('empty');
    },

    inNavbar: function() {
      return this.currentLocation() === 'nav_bar';
    },

    isAdmin: function() {
      return this.currentUser().role() === "admin";
    },

    isFieldCustom: function(id) {
      var field = this.storage.fields[id];
      var TYPES = ['tagger', 'checkbox', 'regexp', 'decimal', 'integer', 'text', 'textarea', 'date'];
      return _.contains(TYPES, field.type);
    },

    isFieldText: function(id) {
      var field = this.storage.fields[id];
      if (!field) {
        return false;
      }
      var TYPES = ['text', 'textarea'];
      return _.contains(TYPES, field.type);
    },

    fieldNameForID: function(id) {
      var name = this.storage.fields[id].type;
      // special case for type
      if (name === 'tickettype') {
        name = 'type';
      }
      // special case for priority
      if (name === 'basic_priority') {
        name = 'priority';
      }
      // special case for custom fields
      if (this.isFieldCustom(id)) {
        name = "custom_field_%@".fmt(id);
      }
      return name;
    },

    ticketFieldForID: function(id) {
      return this.ticketFields(this.fieldNameForID(id));
    },

    fieldExists: function(id) {
      return _.has(this.storage.fields, id);
    },

    fieldValueForID: function(id) {
      if (this.isFieldCustom(id)) {
        return this.ticket().customField(this.fieldNameForID(id));
      } else if (this.storage.fields[id].type === 'group') {
        var group = this.ticket().assignee().group();
        return (typeof group === "undefined") ? '' : group.id().toString();
      } else if (this.storage.fields[id].type === 'tickettype') {
        var type = this.ticket().type();
        return type === 'ticket' ? undefined : type;
      } else if (this.storage.fields[id].type === 'priority') {
        var priority = this.ticket().priority();
        return priority === '-' ? undefined : priority;
      } else {
        return this.ticket()[this.storage.fields[id].type]();
      }
    },

    fieldPresent: function(id) {
      var value = this.fieldValueForID(id);
      var type = this.storage.fields[id].type;
      if (type === 'checkbox') {
        return value == 'yes';
      } else if (type === 'tickettype' && value == 'ticket') {
        return false;
      } else {
        return value;
      }
    },

    setFieldValueForID: function(id, value) {
      if (this.isFieldCustom(id)) {
        return this.ticket().customField(this.fieldNameForID(id), value);
      }
      else {
        return this.ticket()[this.fieldNameForID(id)](value);
      }
    },

    ticketFormForRule: function(rule, ticketForms) {
      return _.find(ticketForms, function(form) {
        return form.id === rule.formId;
      });
    },

    filterItemsCollection: function(coll, filter) {
      if (typeof filter === "undefined" || !filter.length) {
        return coll;
      }
      filter = filter.toLowerCase();
      return _.filter(coll, function(item) {
        return item.name.toLowerCase().indexOf(filter) !== -1;
      });
    },

    removeDoubleColon: function(text) {
      return text.replace(/::/g, " » ");
    },

    markRulesAsClean: function() {
      var rules = this.storage.rules;
      _.each(rules, function(rule) {
        rule.dirty = false;
      });
    },

    // A set of rules can be seen as a graph (nodes being fields and edges
    // representing the "can show" relation).
    buildAdjacencyLists: function(rules) {
      var lists = {};

      function addEdge(from, to) {
        if (!_.has(lists, from)) {
          lists[from] = [to];
        }
        else if (!_.contains(lists[from], to)) {
          lists[from].push(to);
        }
      }

      _.each(rules, function(rule) {
        _.each(rule.select, function(target) {
          addEdge(rule.field, target);
        });
      });
      return lists;
    },

    buildValuesTable: function(rules) {
      var table = {};
      _.each(rules, function(rule) {
        if (!_.has(table, rule.field)) {
          table[rule.field] = {};
        }
        _.each(rule.select, function(target) {
          if (!_.has(table[rule.field], target)) {
            table[rule.field][target] = [];
          }
          table[rule.field][target].push(rule.value);
        });
      });
      return table;
    },

    // Given some adjacency lists, find the nodes with no incoming edge.
    findStartingFields: function(fieldToFieldMap) {
      return _.difference(_.map(_.keys(fieldToFieldMap), function(x) { return parseInt(x, 10) || x; }), _.flatten(_.values(fieldToFieldMap)));
    },

    // Create a DOT representation of the adjacency lists
    generateDot: function(lists, values) {
      var buff = ["digraph dump {"];
      var fields = _.flatten([_.keys(lists), _.values(lists)]);
      fields = _.uniq(fields, false, function(k) {
        return "" + k;
      });
      _.each(fields, (function(field) {
        var name = this.ticketFieldForID(field).label();
        buff.push("%@ [label=\"%@\"];".fmt(field, name));
      }).bind(this));
      _.each(lists, function(targets, from) {
        _.each(targets, function(to) {
          buff.push("%@ -> %@ [ label=\"%@\" ];".fmt(from, to, values[from][to]));
        });
      });
      buff.push("}");
      buff = buff.join('\n');
      console.log("https://chart.googleapis.com/chart?cht=gv&chl=%@".fmt(encodeURIComponent(buff)));
      return buff;
    },

    fieldMatch: function(values, fieldId) {
      var value = this.fieldValueForID(fieldId);
      return _.contains(values, value);
    },

    // Perform rules (actually hide elements from the UI)
    // Apply rules shouldn't be called directly anywhere, it is always
    // called via `applyRulesLater` so that it runs in the next event loop.
    // The deferral allows for updates in the UI to occur before rules are applied.
    _applyRules: function(currentField) {
      // Revert all labels because we no longer know which were required anymore
      this.revertLabels();

      this.currentTicketForm = this.ticket().form().id();

      // Because some account have some tickets created when ticket forms
      // didn't exist, we need to have a default value for the current ticket
      // form. As all account have a default ticket form attached we use its
      // ID.
      if (typeof this.currentTicketForm === "undefined") {
        this.currentTicketForm = this.getDefaultFormID();
      }

      this.saveOriginalLabels();
      this.markRequiredLabels();

      // The ticket form should not always be shown: when an account only has
      // one form, the dropdown is hidden by the framework and should not be
      // revealed.
      var ticketFields = _.reject(this.ticketFields(), (function(field) {
        return _.contains(this.PROTECTED_FIELDS, field.name());
      }).bind(this));
      var rules = this.getRestrictedRules();

      // fields used in a view
      var allConditionalFields = _.uniq(_.flatten(_.pluck(rules, 'select')));
      var fieldsToHide = allConditionalFields;
      var fieldsToShow = [];

      // don't hide the current field
      if (currentField) {
        var currentFieldId = parseInt(currentField.replace(/\D+/, ''), 0);
        fieldsToHide = _.without(allConditionalFields, currentFieldId);
      }

      // required fields
      var requiredFields = this.getRequiredFields();

      var valuesThatSatisfyRules = this.buildValuesTable(rules);
      var fieldToConditionalFieldsMap = this.buildAdjacencyLists(rules);
      var startingFields = this.findStartingFields(fieldToConditionalFieldsMap);

      var enforceRulesOnFields = (function(currentFieldDoesNotSatisfyRule, fieldId) {
        if (currentFieldDoesNotSatisfyRule) {
          var key = "ticket." + this.fieldNameForID(fieldId);
          this.ignoredEvents[key] = true;
          this.setFieldValueForID(fieldId, null);
        }

        _.each(fieldToConditionalFieldsMap[fieldId], (function(conditionalFieldId) {
          var doesNotSatisfyThisTime = currentFieldDoesNotSatisfyRule,
              currField;
          if (!currentFieldDoesNotSatisfyRule) {
            if (this.fieldMatch(valuesThatSatisfyRules[fieldId][conditionalFieldId], fieldId)) {
              fieldsToShow.push(conditionalFieldId);
              currField = this.ticketFieldForID(conditionalFieldId);
              if (!currField.isVisible()) {
                currField.show();
              }
            }
            else {
              doesNotSatisfyThisTime = true;
            }
          }
          enforceRulesOnFields(doesNotSatisfyThisTime, conditionalFieldId);
        }).bind(this));
      }).bind(this);

      // perform enforceRulesOnFields to show matching fields
      _.each(startingFields, this.partial(enforceRulesOnFields, false));

      // hide all fields that are affected by CFA but not shown by rules
      _.invoke(_.map(_.difference(fieldsToHide, fieldsToShow), this.ticketFieldForID.bind(this)), 'hide');

      // disable save if any required fields are missing,
      var missing = _.any(allConditionalFields, function(fieldId) {
        return this.ticketFieldForID(fieldId).isVisible() && _.contains(requiredFields, fieldId) && !this.fieldPresent(fieldId);
      }.bind(this));

      _.defer(function() {
        if (missing) {
          this.disableSave();
        } else {
          this.enableSave();
        }
      }.bind(this));

      this.markRequiredLabels();

      // Defer the cleanup process until all triggered events finished.
      _.defer(function() {
        this.ignoredEvents = {};
      }.bind(this));
    },

    applyRulesLater: function(currentField) {
      _.defer(this._applyRules.bind(this, currentField));
    },

    findIndexForSelection: function() {
      var select = this.SELECTION;
      var rule = _.find(this.storage.rules, function(rule) {
        return rule.field === select.field && rule.value === select.value;
      });
      return rule ? rule.index : null;
    },

    storeRules: function(rules) {
      // Reindex the rules. The index acts as a temporary ID, so as we can edit
      // them easily.
      var index = 0;
      // make sure the order is consistent.
      rules = _.sortBy(rules, function(rule) {
        return [rule.field, rule.value].join(",");
      });

      this.deepCopyRules(_.map(rules, function(rule) {
        rule.index = index++;
        // ensure we have the requireds attribute (migration)
        rule.requireds = (rule.requireds || []);

        return rule;
      }), this.storage.rules);
    },

    // Compute possible values for a given field.
    valuesForField: function(field) {
      var defaultType = function(f) {
        return [{name: "Any", value: null}];
      };

      var systemFieldGetter = function(f) {
        return f.system_field_options;
      };

      var types = {
        "checkbox": function(f) {
          return [
            {name: "Yes", value: "yes"},
            {name: "No", value: "no"}
          ];
        },
        "tagger": function(f) {
          return f.custom_field_options;
        },
        "priority": systemFieldGetter,
        "tickettype": systemFieldGetter,
        "group": (function(f) {
          var values = _.map(this.storage.groups, function(group) {
            return {
              name: group.name,
              value: group.id.toString()
            };
          });
          return _.sortBy(values, 'name');
        }).bind(this)
      };

      return (types[field.type] || defaultType)(field);
    },

    // Retrieve the rule for the given field and value, or null if no such rule
    // exists.
    ruleForFieldAndValue: function(fieldId, value) {
      return _.find(this.getRestrictedRules(), function(rule) {
          return rule.field === fieldId && rule.value === value;
        }) || null;
    },

    // Add a new rule to the rule set
    newRule: function(rule) {
      rule.formId = this.currentTicketForm;
      rule.field = parseInt(rule.field, 10);
      rule.dirty = true;
      var rules = [];
      this.deepCopyRules(this.storage.rules, rules);
      var hash = rule.formId + rule.field + rule.value;
      // remove any old version of the rule
      var oldRule = _.find(rules, function(irule) {
        return hash === irule.formId + irule.field + irule.value;
      });

      var index = oldRule ? _.indexOf(rules, oldRule) : null;

      if (oldRule) { // this is a rule edition or deletion
        rule.creationDate = oldRule.creationDate;
        rules.splice(index, 1);
        rule.requireds = oldRule.requireds;
      }
      else { // this is a rule creation
        rule.creationDate = new Date().getTime();
        rule.requireds = [];
      }
      if (rule.select.length > 0) {
        rules.push(rule);
      }

      this.storeRules(rules);
    },

    // count the number of items in coll with an attribute which evaluates to
    // true.
    countByAttr: function(coll, attr) {
      return _.filter(coll, function(item) {
        return item[attr];
      }).length;
    },

    removeRule: function(index) {
      var rules = this.storage.rules;
      rules.splice(index, 1);
      this.storeRules(rules);
      this.DIRTY.set();
      this.SELECTION.initialize();
      this.trigger('fieldChanged');
      this.trigger('valueChanged');
      this.trigger('selectionChanged');
    },

    reset: function() {
      this.storeRules(this.OLD_RULES);
      this.SELECTION.initialize();
      this.trigger('fieldChanged');
      this.trigger('valueChanged');
      this.trigger('selectionChanged');
      this.DIRTY.clear();
    },

    saveRules: function(options) {
      options = options || {};

      var rulesString;

      if (typeof options.check === "undefined" || options.check) {
        // options.check if some rules target required fields
        var rulesWithRequired = _.map(this.getRestrictedRules(), (function(rule) {
          return [rule, _.intersection(rule.select, this.storage.requiredFieldsIds)];
        }).bind(this));
        var suspectRules = _.filter(rulesWithRequired, function(rule) {
          return rule[1].length;
        });

        // branch out and display a window if so.
        if (suspectRules.length) {
          return this.displayRequiredWarning(suspectRules);
        }

        rulesString = JSON.stringify(this.storage.rules);
        if (rulesString.length > this.RULES_FIELDS_SIZE * this.RULES_FIELDS_NUMBER) {
          return this.$("#limitReachedModal").modal();
        }
      }

      this.markRulesAsClean();
      rulesString = rulesString || JSON.stringify(this.storage.rules);
      this.deepCopyRules(this.storage.rules, this.OLD_RULES);
      this.DIRTY.clear();

      // persist the rules
      if (this.isAdmin()) {
        this.ajax('saveRules', rulesString, options.notify);
      }
    },

    displayRequiredWarning: function(rules) {
      var modal = this.$("#requiredWarningModal");
      var rulesList = modal.find(".faultyRules");
      rulesList.html('');
      _.each(rules, (function(rule) {
        var fields = _.map(rule[0].select, (function(fieldId) {
          return {
            text: this.nameForFieldId(fieldId),
            required: _.contains(rule[1], fieldId)
          };
        }).bind(this));
        var data = {
          title: "%@ > %@".fmt(this.nameForFieldId(rule[0].field), this.valueNameForRule(rule[0])),
          fields: fields
        };
        var html = this.renderTemplate('required_rule', data);
        rulesList.append(html);
      }).bind(this));

      modal.modal();
    },

    deepCopyRules: function(from, to) {
      to.length = 0; // reset the destination array
      _.each(from, (function(rule) {
        var newRule = {};
        _.each(rule, function(value, key) {
          newRule[key] = value;
        });
        to.push(newRule);
      }).bind(this));
    },

    nameForFieldId: function(id) {
      return this.storage.fields[id].name;
    },

    valueNameForRule: function(rule) {
      if (this.isFieldText(rule.field)) {
        return rule.value;
      }

      var targetField = this.storage.fields[rule.field];
      if (!targetField) {
        return null;
      }

      var option = _.find(targetField.values,
        function(v) {
          return v.value === rule.value;
        });

      return option ? option.name : null;
    },

    getCurrentTicketForm: function() {
      return _.find(this.storage.ticketForms, (function(form) {
        return form.id === this.currentTicketForm;
      }).bind(this));
    },

    getRestrictedFields: function() {
      var restricted_arr = _.filter(this.storage.fields, (function(field) {
        return typeof this.currentTicketForm === "undefined" ||
          _.contains(this.getCurrentTicketForm().ticket_field_ids, field.id);
      }).bind(this));

      if (this.currentMode === 'endUser') {
        restricted_arr = _.filter(restricted_arr, function(field) {
          return field.visibleInPortal;
        });
      }

      restricted_arr = _.reject(restricted_arr, function(field) {
        return field.type === 'status';
      });

      // rename group to assignee
      var group = _.find(restricted_arr, function(field) {
        return field.type === 'group';
      });
      if (group) {
        group.name = this.I18n.t('fields.group');
      }

      var pairs = _.map(restricted_arr, function(field) {
        return [field.id, field];
      });
      return this.toObject(pairs);
    },

    getRestrictedRules: function() {
      return _.filter(this.storage.rules, (function(rule) {

        return rule.formId === this.currentTicketForm;
      }).bind(this));
    },

    getDefaultFormID: function() {
      var attr = 'default';
      return _.find(this.storage.ticketForms, function(form) {
        return form['default'];
      }).id;
    },

    updateFilterCrossState: function(target) {
      var input = this.$(target);
      var cross = input.parent().find('.clearSearch');
      if (input.val().length) {
        cross.fadeIn();
      }
      else {
        cross.fadeOut();
      }
    },

    cleanUpAttributes: function(coll, names, value) {
      var isGetter = _.isFunction(value);
      _.each(coll, function(item) {
        _.each(names, function(name) {
          item[name] = isGetter ? value(item) : value;
        });
      });
    },

    getNameForSystemField: function(allFields, fieldId) {
      if (!fieldId) { return; }
      var systemTypes = ['tickettype', 'priority'];
      var fieldType = allFields[fieldId].type;
      var result = fieldId;

      if (_.contains(systemTypes, fieldType)) {
        result = fieldType;
        // Special case so that Helpcenter can identify field as type
        if (result === 'tickettype') { result = 'type'; }
      }
      return result;
    },

    getNamesForSystemFields: function(allFields, fieldIds) {
      if (!fieldIds || fieldIds === []) { return; }
      return _.map(fieldIds, function(fieldId) {
        return this.getNameForSystemField(allFields, fieldId);
      }, this);
    },

    // EVENTS ==================================================================

    // App ---------------------------------------------------------------------

    onPaneActivation: function() {
      if (this.isAdmin()) {
        this.SELECTION.initialize();
        this.switchTo('choices', {
          has_forms: _.filter(this.storage.ticketForms, function(form) {
            return form.active;
          }).length > 1,
          forms: this.storage.ticketForms,
          isEndUser: this.currentMode === 'endUser',
          firstTimeEndUser: this.currentMode === 'endUser' && !this.storage.rules.length
        });
        _.defer(function() {
          this.$('.modeSwitch').zdSelectMenu('setValue', this.currentMode);
          this.$('.formSelect').zdSelectMenu('setValue', this.currentTicketForm);
        }.bind(this));
        this.DIRTY.clear();
        // XXX
        this.trigger('fieldChanged');
      }
      else {
        this.switchTo('denied');
      }
    },

    onPaneDeactivation: function() {
      this.showSidebar();
    },

    onAppDeactivation: function() {
      this.revertLabels();
    },

    onAppCreated: function() {
      this.originalLabels = {};
      this.redraw = new Redrawer();
      this.SELECTION = new Selection(this);
      this.DIRTY = new BooleanState(this, 'rulesDirty', 'rulesClean');
      this.rulesPartialRenderer = partialRenderer(
        this.rulesRendering,
        '.all_rules', {
        selection: this.SELECTION,
        collapsed: []
        },
        this
      );
    },

    onAppActivation: function() {
      this.storage = _.defaults(_.pick(this.storage || {}, 'fields', 'allTicketForms', 'groups'), {
        rules: [],
        fields: [],
        allTicketForms: [],
        ticketForms: [],
        requiredFieldsIds: [],
        groups: {}
      });

      this.OLD_RULES = [];
      this.rulesField = (this.currentMode === 'agent' ? 'rules' : 'user_rules');
      var rules = this.readRulesFromSettings(this.rulesField);

      this.getInitData().then((function() {
        if (this.currentMode === 'endUser') {
          this.storage.ticketForms = _.filter(this.storage.allTicketForms, function(ticketForm) {
            return ticketForm.end_user_visible;
          });
        } else {
          this.storage.ticketForms = this.storage.allTicketForms;
        }

        this.storeRules(this.sanitizeRules(rules, this.storage.ticketForms));
        this.deepCopyRules(this.storage.rules, this.OLD_RULES);

        if (this.storage.ticketForms.length > 0) {
          this.currentTicketForm = this.storage.ticketForms[0].id;
        }
        if (this.inNavbar()) {
          this.onPaneActivation();
        }
        else {
          this.showSidebar();
          this.applyRulesLater();
        }
      }).bind(this));
    },

    readRulesFromSettings: function(rulesField) {
      var text = '';

      for (var i = 0; i < this.RULES_FIELDS_NUMBER; i++) {
        // In order to upgrade smoothly, the first field does not have a suffix
        var key = (i === 0 ? rulesField : [rulesField, i].join('_'));
        var value = this.setting(key);
        if (value) {
          text = text + value;
        }
      }
      if (!text.length) {
        text = '[]';
      }

      return ConditionChecker.getAllValidConditions(JSON.parse(text));
    },

    getAllGroups: function() {
      return this.promise(function(resolve, reject) {
        var groups = [];

        function fail(err) {
          reject(err);
        }

        function done(data) {
          groups = groups.concat(data.groups);

          if (data.next_page) {
            this.ajax('getPage', data.next_page).done(done).fail(fail);
          } else {
            resolve({
              groups: groups,
              count: groups.length
            });
          }
        }

        this.ajax('getGroups').done(done).fail(fail);
      });
    },

    getInitData: function() {
      if (!this.storage.ticketForms.length) {
        return this.when(this.getAllGroups(), this.ajax('getTicketFields'), this.ajax('getTicketForms')).then(function(groupsObj, ticketFieldsObj, ticketFormsObj) {
          // note: groupsObj structure differs to ticketFieldsObj and ticketFormsObj
          this.onGetGroups(groupsObj);
          this.onGetTicketFields(ticketFieldsObj[0]);
          this.onGetTicketForms(ticketFormsObj[0]);
        }.bind(this));
      } else {
        return this.promise(function(done, fail) {
          done();
        });
      }
    },

    saveOriginalLabels: function() {
      if (typeof this.ticketFields !== "undefined") {
        var requiredFields = this.getRequiredFields();

        _.each(requiredFields, function(id) {
          this.originalLabels[id] = this.ticketFieldForID(id).label();
        }.bind(this));
      }
    },

    markRequiredLabels: function() {
      if (typeof this.ticketFields !== "undefined") {
        var requiredFields = this.getRequiredFields();

        _.each(requiredFields, function(id) {
          var field = this.ticketFieldForID(id);
          field.label("%@*".fmt(this.originalLabels[id]));
        }.bind(this));
      }
    },

    revertLabels: function() {
      if (typeof this.ticketFields !== "undefined") {
        _.each(this.originalLabels, function(label, id) {
          var field = this.ticketFieldForID(id);
          if (field && label) {
            field.label(label);
          }
        }.bind(this));
      }
    },

    getRequiredFields: function() {
      var matchingRules = _.filter(this.getRestrictedRules(), function(rule) {
        return this.fieldValueForID(rule.field) == rule.value;
      }.bind(this));
      return _.uniq(_.flatten(_.pluck(matchingRules, 'requireds')));
    },

    fieldsChanged: function(event) {
      if (this.ignoredEvents[event.propertyName]) {
        event.preventDefault();
        return;
      }
      if (typeof this.ticketFields !== "undefined") {
        if (event.propertyName === 'ticket.form.id') {
          this.currentTicketForm = event.newValue;
          this.applyRulesLater();
        }
        else {
          var restrictedRules = this.getRestrictedRules();
          var fields = _.uniq(_.flatten(_.map(restrictedRules, function(rule) {
            return rule.select.concat([rule.field]);
          })));
          fields = _.map(fields, function(id) {
            return "ticket.%@".fmt(this.fieldNameForID(id));
          }.bind(this));

          // special case for ticket's assignee / group
          if (event.propertyName.indexOf('ticket.assignee.') === 0) {
            event.propertyName = 'ticket.group';
          }
          if (_.contains(fields, event.propertyName)) {
            this.applyRulesLater(event.propertyName);
          }
        }
      }
    },

    sanitizeRules: function(rules, ticketForms) {
      var validators = {
        allTargetsExist: function(rule) {
          return _.every(rule.select.concat([rule.field]), this.fieldExists.bind(this));
        },
        valueStillExists: function(rule) {
          return !!this.valueNameForRule(rule);
        },
        formHasAllFields: function(rule) {
          var form = this.ticketFormForRule(rule, ticketForms);
          if (!form) {
            return false;
          }
          var fields = rule.select.concat([rule.field]);
          return _.every(fields, function(field) {
            return _.contains(form.ticket_field_ids, field);
          });
        }
      };

      return _.select(rules, function(rule) {
        return _.every(_.values(validators), function(f) {
          return f.apply(this, [rule]);
        }.bind(this));
      }.bind(this));
    },

    // Requests ----------------------------------------------------------------

    onGetTicketFields: function(data) {
      var fields = _.reject(data.ticket_fields, (function(field) {
        if (!field.active) {
          return true;
        }
        if (_.contains(this.BLACKLIST, field.type)) {
          return true;
        }
        return false;
      }).bind(this));

      this.storage.fields = this.toObject(_.map(fields, (function(field) {
        field.id = parseInt(field.id, 10);
        var required = false;
        if (!this.setting('disable_conflicts_prevention')) {
          required = (this.currentMode === 'endUser' ? field.required_in_portal : field.required);
        }
        return [field.id, {
          id: field.id,
          name: (this.currentMode === 'endUser' ? field.title_in_portal : field.title),
          type: field.type,
          values: this.valuesForField(field),
          systemRequired: required,
          visibleInPortal: field.visible_in_portal
        }];
      }).bind(this)));

      var requiredFields = _.filter(this.storage.fields, function(field) {
        return field.required;
      });

      this.storage.requiredFieldsIds = _.pluck(requiredFields, 'id');
    },

    onGetTicketForms: function(data) {
      this.storage.allTicketForms = _.filter(data.ticket_forms, function(ticketForm) {
        return ticketForm.active;
      });
    },

    onGetGroups: function(data) {
      this.storage.groups = data.groups;
    },

    // UI ----------------------------------------------------------------------

    onDeleteAllClick: function(event) {
      event.preventDefault();
      this.$("#deleteAllModal").modal();
    },

    onConfirmDeleteAllClick: function(event) {
      event.preventDefault();

      // remove all rules on the current ticket form
      this.OLD_RULES = _.reject(this.OLD_RULES, (function(rule) {
        return rule.formId === this.currentTicketForm;
      }).bind(this));

      this.reset();
      this.saveRules({ notify: false, check: false });
      services.notify(this.I18n.t("notices.allDeleted"), "error");
    },

    onConfirmRulesSave: function(event) {
      event.preventDefault();
      this.saveRules({ notify: true, check: false });
    },

    onTicketFormChange: function(event) {

      var $formSelect = this.$(".formSelect"),
          id = parseInt($formSelect.zdSelectMenu('value'), 10),
          formChanged = this.currentTicketForm && this.currentTicketForm != id,
          ignoreEvent = this.ignoredEvents['zd_ui_change .formSelect'],
          unsavedChanges = this.dirtyRulesCount();

      if (!ignoreEvent) {
        this.when((formChanged && unsavedChanges) ? this.unsavedChangesModal() : null).then(function onOk(saveRules) {
          if (saveRules) {
            this.saveRules();
          }

          this.currentTicketForm = id;
          this.reset();
        }.bind(this), function onCancel() {
          // Revert form change and ignore the event so we don't show a modal twice
          this.ignoredEvents['zd_ui_change .formSelect'] = true;
          $formSelect.zdSelectMenu('setValue', this.currentTicketForm);
          this.ignoredEvents['zd_ui_change .formSelect'] = false;
        }.bind(this));
      }
    },

    onFieldClick: function(event) {
      event.preventDefault();
      this.onDisableRequired(event);
      this.SELECTION.setField(this.$(event.target).attr('value'));
      this.SELECTION.setValue(null);
      this.SELECTION.setSelect([]);
    },

    onValueClick: function(event) {
      event.preventDefault();
      this.onDisableRequired(event);
      this.SELECTION.setValue(this.$(event.target).attr('value'), 10);

      var rule = this.ruleForFieldAndValue(parseInt(this.SELECTION.field, 10),
        this.SELECTION.value);

      this.SELECTION.setSelect(rule !== null ? rule.select : []);
    },

    onSelectedFieldClick: _.debounce(function(event) {
      event.preventDefault();
      var link = this.$(event.target);
      if (!link.parent().hasClass('unselectable')) {
        var id = parseInt(link.attr('value'), 10);
        var rule = this.getCurrentRule();
        if (rule) {
          var index = rule.requireds.indexOf(id);
          if (index >= 0) {
            rule.requireds.splice(index, 1);
          }
        }
        this.SELECTION.toggleSelect(id);
      }
    }, 200, true),

    onCancelClick: function(event) {
      event.preventDefault();
      this.reset();
    },

    onSaveClick: function(event) {
      this.onDisableRequired(event);
      this.saveRules();
    },

    onRuleDeleteClick: function(event) {
      event.preventDefault();
      var index = parseInt(this.$(event.target).attr('value'), 10);
      var rule = this.storage.rules[index];
      var text = "%@ > %@".fmt(this.nameForFieldId(rule.field), this.valueNameForRule(rule));
      this.$("#deleteOneModal .modalRuleDisplay h4").html(text);
      text = _.map(rule.select, this.nameForFieldId.bind(this)).join(', ');
      this.$("#deleteOneModal .modalRuleDisplay p").html(text);
      this.$("#deleteOneModal .yes").attr('value', index);
      this.$("#deleteOneModal").modal();
    },

    onRuleDeleteConfirmClick: function(event) {
      event.preventDefault();
      var index = this.$(event.target).attr('value');
      this.removeRule(index);
      services.notify(this.I18n.t("notices.deleted"), "error");
      this.saveRules({ notify: false, check: false });
    },

    onGenerateSnippetClick: function(event) {
      var rules = [];
      var fields = this.storage.fields;

      this.deepCopyRules(this.storage.rules, rules);
      rules = _.map(rules, function(rule) {
        if (!_.has(fields, rule.field)) {
          return null;
        }

        return {
          fieldType: fields[rule.field].type,
          field: this.getNameForSystemField(fields, rule.field),
          value: rule.value,
          select: this.getNamesForSystemFields(fields, rule.select),
          formId: rule.formId,
          requireds: this.getNamesForSystemFields(fields, rule.requireds) || []
        };
      }, this);
      var rulesString = JSON.stringify(_.compact(rules));
      var snippet = [
        '<script src="https://zendesk.tv/conditional_fields/helpcenter.js"></script>',
        helpers.fmt('<script>var cfaRules = %@;</script>', rulesString)
      ].join('\n');
      this.$("#snippetModal .modalSnippetCode").text(snippet);
      this.$("#snippetModal").modal();
    },

    onFilterFieldsChange: function(event) {
      this.redraw.fields(this);
      this.updateFilterCrossState(event.target);
    },

    onFilterValuesChange: function(event) {
      this.redraw.values(this);
      this.updateFilterCrossState(event.target);
    },

    onFilterSelectedFieldsChange: function(event) {
      this.redraw.selection(this);
      this.updateFilterCrossState(event.target);
    },

    onCollapseMenuClick: function(event) {
      event.preventDefault();
      var id = this.$(event.target).closest('.collapse_menu').attr('value');
      this.rulesPartialRenderer.state.toggleCollapsed = id;
      this.rulesPartialRenderer.render();
    },

    onRuleItemClick: function(event) {
      event.preventDefault();
      var link = this.$(event.target);
      var index = link.attr('value');
      var rule = this.storage.rules[index];
      this.SELECTION.setFromRule(rule);
      this.rulesPartialRenderer.render();
    },

    onClearSearchClick: function(event) {
      event.preventDefault();
      this.$(event.target).parent().find("input").val('').trigger('keyup');
    },

    onRuleMouseHover: function(event) {
      var element = this.$(event.target).closest('.rule li.value');
      if (!element.hasClass('hardSelect')) {
        var deleteLink = element.find('.deleteRule');
        if (event.type === 'mouseenter') {
          element.addClass('selectedRule');
          deleteLink.show();
        }
        else {
          element.removeClass('selectedRule');
          deleteLink.hide();
        }
      }
    },

    onModeSwitchChange: function(event) {
      var $modeSwitch = this.$('.modeSwitch'),
          newMode = $modeSwitch.zdSelectMenu('value'),
          modeChanged = newMode !== this.currentMode,
          ignoreEvent = this.ignoredEvents['zd_ui_change .modeSwitch'],
          unsavedChanges = this.dirtyRulesCount();

      if (modeChanged && !ignoreEvent) {
        this.when(unsavedChanges ? this.unsavedChangesModal() : null).then(function onOk(saveRules) {
          if (saveRules) {
            this.saveRules();
          }

          this.currentMode = newMode;
          this.switchTo('loading');
          this.onAppActivation();
        }.bind(this), function onCancel() {
          // Revert mode switch and ignore the event so we don't show a modal twice
          this.ignoredEvents['zd_ui_change .modeSwitch'] = true;
          $modeSwitch.zdSelectMenu('setValue', this.currentMode);
          this.ignoredEvents['zd_ui_change .modeSwitch'] = false;
        }.bind(this));
      }
    },

    onCopyRulesClick: function(event) {
      this.$('.firstTimeEndUser').html(this.renderTemplate('loading'));

      var rulesToCopy = this.readRulesFromSettings('rules');
       // reject rules that are not part of the current set of forms
      rulesToCopy = _.reject(rulesToCopy, function(rule) {
        return !this.ticketFormForRule(rule, this.storage.ticketForms);
      }.bind(this));

      this.storeRules(rulesToCopy);

      this.DIRTY.clear();
      this.trigger('fieldChanged');
      this.$('.firstTimeEndUser').hide();
      this.$('.table').show();
      this.saveRules();
    },

    onNewSetRulesClick: function(event) {
      this.$('.firstTimeEndUser').hide();
      this.$('.table').show();
    },

    onTextValueInput: function(event) {
      var value = this.$('.values-text-input').val();
      this.SELECTION.setValue(value.length ? value : null, true);
      this.SELECTION.setSelect([], true);
    },

    // Data binding ------------------------------------------------------------

    // Redraw the value column based on the currently selected field and the
    // currently selected value.
    onValueChanged: function(event) {
      this.redraw.values(this);
    },

    // Redraw the field column based on the currently selected field
    onFieldChange: function(event) {
      this.redraw.fields(this);
    },

    // Redraw the selection column based on the current selection
    onSelectionChanged: function(event) {
      // update the current rule
      this.newRule(this.SELECTION.getRule());
      this.redraw.selection(this);
      this.trigger('fieldChanged');
      this.trigger('valueChanged');
      this.DIRTY.set();
    },

    ruleHash: function(rule) {
      return rule.formId + rule.field + rule.value;
    },

    findMatchingRule: function(set, rule) {
      var FIELDS = ['formId', 'field', 'value'];
      return _.find(set, function(oldRule) {
        return _.all(FIELDS, function(field) {
          return oldRule[field] === rule[field];
        });
      });
    },

    arraysSimilar: function(array1, array2) {
      if (array1.length !== array2.length) {
        return false;
      }
      return _.intersection(array1, array2).length === array1.length;
    },

    dirtyRulesCount: function() {
      // count added and modified rules
      var dirtyCount = this.countBy(this.storage.rules, function(rule) {
        var oldRule = this.findMatchingRule(this.OLD_RULES, rule);
        return !oldRule || !this.arraysSimilar(oldRule.select, rule.select) || !this.arraysSimilar(oldRule.requireds, rule.requireds);
      }.bind(this));

      // count removed rules
      dirtyCount += Math.max(this.OLD_RULES.length - this.storage.rules.length, 0);

      return dirtyCount;
    },

    onRulesDirty: function(event) {
      var dirtyCount = this.dirtyRulesCount();
      if (dirtyCount) {
        this.$('.cfa_navbar').find('.cancel, .save').removeAttr('disabled');
        var text = helpers.fmt("%@ (%@)", this.I18n.t('rules.save'), dirtyCount);
        this.$('.cfa_navbar .save').html(text);
      } else {
        this.$('.cfa_navbar').find('.cancel, .save').attr('disabled', true);
        this.$('.cfa_navbar .save').html(this.I18n.t('rules.save'));
      }
      this.trigger('rulesChanged');
    },

    onRulesClean: function(event) {
      this.$('.cfa_navbar').find('.cancel, .save').attr('disabled', true);
      this.$('.cfa_navbar .save').html(this.I18n.t('rules.save'));
      this.trigger('rulesChanged');
    },

    onRulesChanged: function(event) {
      this.rulesPartialRenderer.render(this.getRestrictedRules());
      var deleteAllButton = this.$('.deleteAll');
      if (this.storage.rules.length) {
        deleteAllButton.show();
      }
      else {
        deleteAllButton.hide();
      }
    },

    onEnableRequired: function(event) {
      this.newRequires = [];
      event.preventDefault();
      this.$('.enable-required').hide();
      this.$('.disable-required').show();
      this.$('.selected input').prop('checked', false).show();
      var $ = this.$;
      this.$('.selected li.required').each(function() {
        $(this).find('input').prop('checked', true);
        $(this).find('.requiredTag').hide();
      });
    },

    getCurrentRule: function() {
      var sel = this.SELECTION.getRule(),
          app = this;
      return _.find(this.storage.rules, function(rule) {
        return rule.field == sel.field &&
          rule.value == sel.value &&
          rule.formId === app.currentTicketForm;
      });
    },

    allRulesForCurrentForm: function() {
      var app = this;

      return _.filter(this.storage.rules, function(rule) {
        return rule.formId === app.currentTicketForm;
      });
    },

    // Shows the unsaved changes modal and returns a promise representing the user's choice
    unsavedChangesModal: function() {
      return this.promise(function(done, fail) {
        var $modal = this.$("#unsavedChangesModal").modal();
        $modal.on('hide', function() {
          _.delay(fail);
        });
        $modal.find(".yes").on('click', function(event) {
          _.delay(done.bind(null, true));
        });
        $modal.find(".no").on('click', function(event) {
          _.delay(done.bind(null, false));
        });
      });
    },

    onDisableRequired: function(event) {
      event.preventDefault();
      this.$('.enable-required').show();
      this.$('.disable-required').hide();

      var $ = this.$;
      var rule = this.getCurrentRule();
      if (rule && this.$('.selected input:visible').size()) {
        rule.requireds = [];
        this.$('.selected input').each(function() {
          var checkbox = $(this);
          if (checkbox.is(':checked')) {
            var id = parseInt(checkbox.data('value'), 10);
            rule.requireds.push(id);
          }
        });
      }
      this.redraw.selection(this);
      this.DIRTY.set();
    }
  };
}());
;
}
var app = ZendeskApps.defineApp(source)
  .reopenClass({"location":{"zendesk":{"nav_bar":"_legacy","ticket_sidebar":"_legacy","new_ticket_sidebar":"_legacy"}},"noTemplate":["ticket_sidebar","new_ticket_sidebar"],"singleInstall":false,"signedUrls":false})
  .reopen({
    appName: "Conditional Fields",
    appVersion: "1.2.8",
    assetUrlPrefix: "https://19078.apps.zdusercontent.com/19078/assets/1471499321-763a059c5f5f537ca76e10d686b207cc/",
    appClassName: "app-19078",
    author: {
      name: "Zendesk",
      email: "support@zendesk.com"
    },
    translations: {"app":{"name":"Conditional Fields App","parameters":{"disable_conflicts_prevention":{"label":"Remove conflict prevention warnings","helpText":"Use caution if you enable this setting."}}},"rules":{"empty":"Select your first condition","helpText":"To configure your conditions, select a field, a value for that field, and the appropriate field to show.","title":"Manage conditional fields","summary":"Conditions in this form ({{count}})","fields":"Fields","values":"Values","select":"Fields to show","cancel":"Cancel changes","save":"Save","copy":"Copy my Agent conditional fields rules","or":"or","newSet":"Start a new set of rules","deleteAll":"Delete all conditional rules","deleteAllForForm":"Delete all conditional rules for this form","formLabel":"Ticket Form:","modeLabel":"Conditions for:","generateSnippet":"Generate rules for Help Center","requiredWarning":"This field is required","alreadyUsedFieldError":"This field is already used in another rule","valuesTextInput":"Enter text to trigger the rule"},"modes":{"agent":"Agent","endUser":"End User"},"fields":{"group":"Groups"},"notices":{"saved":"Your rules have been saved.","allDeleted":"All your rules have been deleted.","deleted":"Your rule has been deleted."},"loading":"Loading...","modal":{"unsavedChanges":{"title":"Unsaved changes","text":"There are unsaved changes which will be lost if you continue, do you want to save them first?","yes":"Yes, Save changes","no":"No, don't save changes","cancel":"Cancel"},"limitReached":{"title":"Storage limit reached","text":"You have reached the limit of your rules storage space. Please reduce the number of rules.","cancel":"Cancel"},"snippet":{"title":"Generate rules for Help Center","text":"You need to paste this code snippet in the Document Head template in Help Center.","dismiss":"Cancel"},"deleteAll":{"title":"Delete all rules?","text":"If you click Yes, all your rules will be permanently deleted.","yes":"Yes, delete all the rules","no":"Cancel"},"deleteOne":{"title":"Delete the rule?","text":"Are you sure you want to delete the following rule? This action is not reversible.","yes":"Confirm","no":"Cancel"},"requiredWarning":{"title":"This rule affects a required field","text":"Are you sure you want to save the following rule? Please keep in mind that doing so might lead to your agents not being able to submit tickets because the following rule affects a required field:","cancel":"Cancel and go back to editing","yes":"Confirm and save"}},"appstatus":"The app is running on this ticket.","docLink":"Learn more.","accessdenied":"This page is for administrators only. Please contact your Zendesk administrator for more information.","separators":{"availableCount":"Available ({{count}})","available":"Available","existing":"Existing conditions ({{count}})","unavailable":"Unavailable"},"required":{"enable":"Required","disable":"Done","required":"(Required)"}},
    templates: {"choices":"\u003cdiv class=\"pane left\"\u003e\n  \u003caside class=\"sidebar\"\u003e\n    \u003cp\u003e{{t \"rules.helpText\"}} \u003ca href=\"https://support.zendesk.com/entries/26674953-Using-the-Conditional-Fields-app-Enterprise-Only-\" target=\"_blank\"\u003e{{t \"docLink\"}}\u003c/a\u003e\u003c/p\u003e\u003cbr/\u003e\n\n    \u003ch4\u003e{{t \"rules.modeLabel\"}}\u003c/h4\u003e\n    \u003cselect class='modeSwitch' data-zd-type=\"select_menu\"\u003e\n      \u003coption value=\"agent\"\u003e{{t \"modes.agent\"}}\u003c/option\u003e\n      \u003coption value=\"endUser\"\u003e{{t \"modes.endUser\"}}\u003c/option\u003e\n    \u003c/select\u003e\n\n    {{#if has_forms}}\n      \u003ch4\u003e{{t \"rules.formLabel\"}}\u003c/h4\u003e\n      \u003cselect id=\"form\" data-zd-type=\"select_menu\" class='formSelect'\u003e\n        {{#forms}}\n        \u003coption value=\"{{id}}\"\u003e{{name}}\u003c/option\u003e\n        {{/forms}}\n      \u003c/select\u003e\n    {{/if}}\n\n    \u003cdiv class=\"all_rules\"\u003e\u003c/div\u003e\n\n    {{#if isEndUser}}\n      \u003cbutton class=\"generateSnippet btn\"\u003e{{t \"rules.generateSnippet\"}}\u003c/button\u003e\n    {{/if}}\n  \u003c/aside\u003e\n\u003c/div\u003e\n\n\u003cdiv class=\"pane right section\"\u003e\n  \u003csection class=\"main\"\u003e\n    {{#if firstTimeEndUser}}\n      \u003cdiv class='firstTimeEndUser'\u003e\n\n        \u003cbutton class='copyRules btn'\u003e{{t \"rules.copy\"}}\u003c/button\u003e\n        \u003cspan class='or'\u003e{{t \"rules.or\"}}\u003c/span\u003e\n        \u003cbutton class='newSetRules btn'\u003e{{t \"rules.newSet\"}}\u003c/button\u003e\n\n      \u003c/div\u003e\n    {{/if}}\n\n\n\n    \u003cul class=\"table-header clearfix\"\u003e\n        \u003cli\u003e{{t \"rules.fields\"}}\u003c/li\u003e\n        \u003cli\u003e{{t \"rules.values\"}}\u003c/li\u003e\n        \u003cli\u003e{{t \"rules.select\"}} (\u003cspan class=\"selected_count\"\u003e0\u003c/span\u003e)\u003c/li\u003e\n    \u003c/ul\u003e\n\n\n    \u003cdiv class='table-wrapper'\u003e\n        \u003ctable class=\"table {{#if firstTimeEndUser}}hide{{/if}}\"\u003e\n            \u003ctbody\u003e\n            \u003ctr\u003e\n                \u003ctd class=\"fields\"\u003e\u003c/td\u003e\n                \u003ctd\u003e\n                    \u003cinput class='values-text-input' style='display: none' placeholder=\"{{t \"rules.valuesTextInput\"}}\"\u003e\n                    \u003cdiv class='values'\u003e\n                    \u003c/div\u003e\n                \u003c/td\u003e\n                \u003ctd class=\"selected\"\u003e\u003c/td\u003e\n            \u003c/tr\u003e\n            \u003c/tbody\u003e\n        \u003c/table\u003e\n    \u003c/div\u003e\n  \u003c/section\u003e\n\u003c/div\u003e\n\n\u003cdiv class=\"modal hide fade\" tabindex=\"-1\" role=\"dialog\" id=\"unsavedChangesModal\"\u003e\n  \u003cdiv class=\"modal-header\"\u003e\n    \u003ch3\u003e{{t \"modal.unsavedChanges.title\"}}\u003c/h3\u003e\n  \u003c/div\u003e\n  \u003cdiv class=\"modal-body\"\u003e\n    \u003cp\u003e{{t \"modal.unsavedChanges.text\"}}\u003c/p\u003e\n  \u003c/div\u003e\n  \u003cdiv class=\"modal-footer\"\u003e\n    \u003cbutton class=\"btn pull-left\" data-dismiss=\"modal\"\u003e{{t \"modal.unsavedChanges.cancel\"}}\u003c/button\u003e\n    \u003cbutton class=\"btn no\" data-dismiss=\"modal\"\u003e{{t \"modal.unsavedChanges.no\"}}\u003c/button\u003e\n    \u003cbutton class=\"btn btn-primary yes\" data-dismiss=\"modal\"\u003e\n      {{t \"modal.unsavedChanges.yes\"}}\n    \u003c/button\u003e\n  \u003c/div\u003e\n\u003c/div\u003e\n\n\u003cdiv class=\"modal hide fade\" tabindex=\"-1\" role=\"dialog\" id=\"deleteAllModal\"\u003e\n  \u003cdiv class=\"modal-header\"\u003e\n    \u003ch3\u003e{{t \"modal.deleteAll.title\"}}\u003c/h3\u003e\n  \u003c/div\u003e\n  \u003cdiv class=\"modal-body\"\u003e\n    \u003cp\u003e{{t \"modal.deleteAll.text\"}}\u003c/p\u003e\n  \u003c/div\u003e\n  \u003cdiv class=\"modal-footer\"\u003e\n    \u003cbutton class=\"btn\" data-dismiss=\"modal\"\u003e{{t \"modal.deleteAll.no\"}}\u003c/button\u003e\n    \u003cbutton class=\"btn btn-danger yes\" data-dismiss=\"modal\"\u003e\n      {{t \"modal.deleteAll.yes\"}}\n    \u003c/button\u003e\n  \u003c/div\u003e\n\u003c/div\u003e\n\n\u003cdiv class=\"modal hide fade\" tabindex=\"-1\" role=\"dialog\" id=\"deleteOneModal\"\u003e\n  \u003cdiv class=\"modal-header\"\u003e\n    \u003ch3\u003e{{t \"modal.deleteOne.title\"}}\u003c/h3\u003e\n  \u003c/div\u003e\n  \u003cdiv class=\"modal-body\"\u003e\n    \u003cp\u003e{{t \"modal.deleteOne.text\"}}\u003c/p\u003e\n    \u003cdiv class=\"modalRuleDisplay\"\u003e\n      \u003ch4\u003e\u003c/h4\u003e\n      \u003cp\u003e\u003c/p\u003e\n    \u003c/div\u003e\n  \u003c/div\u003e\n  \u003cdiv class=\"modal-footer\"\u003e\n    \u003cbutton class=\"btn\" data-dismiss=\"modal\"\u003e{{t \"modal.deleteOne.no\"}}\u003c/button\u003e\n    \u003cbutton class=\"btn btn-danger yes\" data-dismiss=\"modal\"\u003e\n      {{t \"modal.deleteOne.yes\"}}\n    \u003c/button\u003e\n  \u003c/div\u003e\n\u003c/div\u003e\n\n\u003cdiv class=\"modal hide fade\" tabindex=\"-1\" role=\"dialog\" id=\"requiredWarningModal\"\u003e\n  \u003cdiv class=\"modal-header\"\u003e\n    \u003ch3\u003e{{t \"modal.requiredWarning.title\"}}\u003c/h3\u003e\n  \u003c/div\u003e\n  \u003cdiv class=\"modal-body\"\u003e\n    \u003cp\u003e{{t \"modal.requiredWarning.text\"}}\u003c/p\u003e\n    \u003cul class=\"faultyRules\"\u003e\n    \u003c/ul\u003e\n  \u003c/div\u003e\n  \u003cdiv class=\"modal-footer\"\u003e\n    \u003cbutton class=\"btn\" data-dismiss=\"modal\"\u003e\n      {{t \"modal.requiredWarning.cancel\"}}\n    \u003c/button\u003e\n    \u003cbutton class=\"btn btn-danger yes\" data-dismiss=\"modal\"\u003e\n      {{t \"modal.requiredWarning.yes\"}}\n    \u003c/button\u003e\n  \u003c/div\u003e\n\u003c/div\u003e\n\n\u003cdiv class=\"modal hide fade\" tabindex=\"-1\" role=\"dialog\" id=\"limitReachedModal\"\u003e\n  \u003cdiv class=\"modal-header\"\u003e\n    \u003ch3\u003e{{t \"modal.limitReached.title\"}}\u003c/h3\u003e\n  \u003c/div\u003e\n  \u003cdiv class=\"modal-body\"\u003e\n    \u003cp\u003e{{t \"modal.limitReached.text\"}}\u003c/p\u003e\n  \u003c/div\u003e\n  \u003cdiv class=\"modal-footer\"\u003e\n    \u003cbutton class=\"btn\" data-dismiss=\"modal\"\u003e\n      {{t \"modal.limitReached.cancel\"}}\n    \u003c/button\u003e\n  \u003c/div\u003e\n\u003c/div\u003e\n\n\u003cdiv class=\"modal hide fade\" tabindex=\"-1\" role=\"dialog\" id=\"snippetModal\"\u003e\n  \u003cdiv class=\"modal-header\"\u003e\n    \u003ch3\u003e{{t \"modal.snippet.title\"}}\u003c/h3\u003e\n  \u003c/div\u003e\n  \u003cdiv class=\"modal-body\"\u003e\n    \u003cp\u003e{{t \"modal.snippet.text\"}} \u003ca href=\"https://support.zendesk.com/entries/26674953-Using-the-Conditional-Fields-app-Enterprise-Only-\" target=\"_blank\"\u003e{{t \"docLink\"}}\u003c/a\u003e\u003c/p\u003e\n    \u003cpre\u003e\n      \u003ccode class=\"modalSnippetCode\"\u003e\u003c/code\u003e\n    \u003c/pre\u003e\n  \u003c/div\u003e\n  \u003cdiv class=\"modal-footer\"\u003e\n    \u003cbutton class=\"btn\" data-dismiss=\"modal\"\u003e{{t \"modal.snippet.dismiss\"}}\u003c/button\u003e\n  \u003c/div\u003e\n\u003c/div\u003e","denied":"{{t \"accessdenied\"}}","empty":"\u003cdiv class=\"alert alert-success empty-sidebar\"\u003e\n       {{t \"appstatus\"}}\n\u003c/div\u003e","fields":"\u003cdiv class='separator'\u003e{{t \"separators.availableCount\" count=freeFields.length}}\u003c/div\u003e\n\n\u003cul class='available'\u003e\n  {{#freeFields}}\n    \u003cli {{#if selected}}class=\"active\"{{/if}}\u003e\n      \u003ca value=\"{{id}}\" class=\"field{{#if assigned}} assigned{{/if}}\"\u003e{{name}}\u003c/a\u003e\n    \u003c/li\u003e\n  {{/freeFields}}\n\u003c/ul\u003e\n\n{{#if usedFields.length}}\n  \u003cdiv class='separator'\u003e{{t \"separators.existing\" count=usedFields.length}}\u003c/div\u003e\n  \u003cul class='available'\u003e\n    {{#usedFields}}\n      \u003cli {{#if selected}}class=\"active\"{{/if}}\u003e\n        \u003ca value=\"{{id}}\" class=\"field{{#if assigned}} assigned{{/if}}\"\u003e{{name}}\u003c/a\u003e\n      \u003c/li\u003e\n    {{/usedFields}}\n  \u003c/ul\u003e\n{{/if}}","layout":"\u003cstyle\u003e\n@charset \"UTF-8\";\n.app-19078 header .logo {\n  background-image: url(\"https://19078.apps.zdusercontent.com/19078/assets/1471499321-763a059c5f5f537ca76e10d686b207cc/logo-small.png\"); }\n.app-19078 .empty-sidebar {\n  margin-bottom: 0px;\n  margin-top: 9px; }\n.app-19078.main_panes.apps_nav_bar {\n  padding: 0; }\n  .app-19078.main_panes.apps_nav_bar header {\n    top: 42px;\n    border-top: 0;\n    height: 43px;\n    margin: 0; }\n  .app-19078.main_panes.apps_nav_bar .pane {\n    bottom: 50px; }\n    .app-19078.main_panes.apps_nav_bar .pane.left {\n      width: 330px; }\n    .app-19078.main_panes.apps_nav_bar .pane.right {\n      left: 330px; }\n  .app-19078.main_panes.apps_nav_bar [data-main] {\n    position: absolute;\n    top: 0;\n    bottom: 54px;\n    left: 0;\n    right: 0; }\n    .app-19078.main_panes.apps_nav_bar [data-main] .loading .spinner {\n      margin-top: 25%; }\n    .app-19078.main_panes.apps_nav_bar [data-main] .left {\n      background-color: #f8f8f8;\n      position: absolute; }\n    .app-19078.main_panes.apps_nav_bar [data-main] .right {\n      border-left: 1px solid #d5d5d5; }\n  .app-19078.main_panes.apps_nav_bar footer.cfa_footer {\n    background-color: #f5f5f5;\n    border-top: 1px solid #ddd;\n    bottom: 0;\n    height: 53px;\n    position: fixed;\n    padding: 0; }\n    .app-19078.main_panes.apps_nav_bar footer.cfa_footer .pane {\n      margin: 10px; }\n      .app-19078.main_panes.apps_nav_bar footer.cfa_footer .pane .text-error {\n        color: red;\n        background: none;\n        padding-top: 0.7em; }\n      .app-19078.main_panes.apps_nav_bar footer.cfa_footer .pane .cancel {\n        padding-top: 0.5em;\n        padding-bottom: 0.5em;\n        margin-right: 0.5em; }\n      .app-19078.main_panes.apps_nav_bar footer.cfa_footer .pane .save {\n        padding-left: 2em;\n        padding-right: 2em;\n        padding-top: 0.5em;\n        padding-bottom: 0.5em; }\n.app-19078 .sidebar {\n  margin: 20px 25px 0px; }\n.app-19078 .sidebar .generateSnippet {\n  margin-top: 15px;\n  margin-left: auto;\n  margin-right: auto;\n  display: block; }\n.app-19078 .sidebar h4 {\n  margin-bottom: 10px; }\n.app-19078 .sidebar .zd-selectmenu {\n  margin-bottom: 20px; }\n.app-19078 .sidebar select {\n  margin-bottom: 25px;\n  width: 100%; }\n.app-19078 .sidebar .all_rules .global {\n  border-top: 1px solid #d5d5d5; }\n.app-19078 .sidebar .all_rules .rule {\n  border-bottom: 1px solid #d5d5d5;\n  font-size: 13px;\n  line-height: 18px;\n  padding: 10px; }\n  .app-19078 .sidebar .all_rules .rule .ruleTitle {\n    text-overflow: ellipsis;\n    white-space: nowrap;\n    overflow: hidden; }\n    .app-19078 .sidebar .all_rules .rule .ruleTitle a.field {\n      overflow: hidden;\n      text-overflow: ellipsis;\n      white-space: nowrap;\n      width: calc(100% - 63px);\n      display: inline-block;\n      vertical-align: -0.8em; }\n  .app-19078 .sidebar .all_rules .rule .altText {\n    color: #AAA;\n    font-weight: bold; }\n  .app-19078 .sidebar .all_rules .rule .field {\n    font-weight: bold;\n    margin-bottom: 5px; }\n  .app-19078 .sidebar .all_rules .rule .collapse_menu {\n    color: black; }\n  .app-19078 .sidebar .all_rules .rule ul.collapsed {\n    display: none; }\n  .app-19078 .sidebar .all_rules .rule ul {\n    background-color: #f5f5f5; }\n    .app-19078 .sidebar .all_rules .rule ul .altText {\n      font-weight: normal; }\n    .app-19078 .sidebar .all_rules .rule ul p {\n      margin-left: 20px; }\n  .app-19078 .sidebar .all_rules .rule li {\n    padding: 5px 5px 5px 20px; }\n    .app-19078 .sidebar .all_rules .rule li.selectedRule {\n      background-color: #ededed; }\n    .app-19078 .sidebar .all_rules .rule li.hardSelect {\n      border: 1px solid #e5e5e5; }\n  .app-19078 .sidebar .all_rules .rule .value a {\n    color: #444; }\n  .app-19078 .sidebar .all_rules .rule .value p {\n    color: #999;\n    white-space: nowrap;\n    overflow: hidden;\n    text-overflow: ellipsis; }\n  .app-19078 .sidebar .all_rules .rule .value .ruleItem:hover {\n    text-decoration: underline;\n    color: #146eaa; }\n.app-19078 .sidebar .all_rules .empty {\n  border-bottom: 1px solid #d5d5d5;\n  font-style: italic;\n  padding: 10px 0;\n  text-align: center; }\n.app-19078 .main {\n  height: 100%;\n  max-width: 1000px;\n  min-width: 650px; }\n  .app-19078 .main .intro {\n    margin: 0px 25px;\n    max-width: 1000px; }\n  .app-19078 .main h3 {\n    font-size: 1.5em;\n    font-weight: normal;\n    margin-bottom: 10px; }\n  .app-19078 .main .firstTimeEndUser {\n    text-align: center;\n    margin-top: 100px; }\n    .app-19078 .main .firstTimeEndUser .or {\n      font-size: 1.8em;\n      display: inline-block;\n      margin-left: 1em;\n      margin-right: 1em;\n      position: relative;\n      top: 0.2em; }\n  .app-19078 .main ul.table-header {\n    height: 36px;\n    max-width: 1000px;\n    margin-left: 0px;\n    text-transform: uppercase;\n    line-height: 14px;\n    border-left: none; }\n    .app-19078 .main ul.table-header li {\n      font-size: 13px;\n      float: left;\n      width: 33.33%;\n      background-color: #f8f8f8;\n      border-bottom: 1px solid #ddd;\n      height: 36px;\n      display: block;\n      padding: 10px;\n      box-sizing: border-box;\n      text-transform: initial;\n      font-weight: bold; }\n    .app-19078 .main ul.table-header li:nth-child(3) {\n      padding-left: 31px; }\n  .app-19078 .main .table-wrapper {\n    height: calc(100% - 35px);\n    overflow: auto;\n    display: block;\n    clear: both; }\n  .app-19078 .main table {\n    max-width: 1000px;\n    min-width: 640px;\n    table-layout: fixed;\n    border-bottom: 1px solid #d3d3d3;\n    margin-bottom: 0; }\n    .app-19078 .main table th, .app-19078 .main table td {\n      padding: 0; }\n    .app-19078 .main table tbody {\n      /* This is to create space for the tick in the third column */ }\n      .app-19078 .main table tbody tr:hover td {\n        background-color: #fff; }\n      .app-19078 .main table tbody td {\n        border-top: none;\n        border-right: 1px solid #d3d3d3;\n        padding: 15px 5px 0px; }\n      .app-19078 .main table tbody td.selected .separator {\n        padding-left: 26px; }\n      .app-19078 .main table tbody td.selected li a {\n        margin-left: 20px; }\n      .app-19078 .main table tbody .separator {\n        color: #9a9a9a;\n        font-size: 11px;\n        line-height: 11px;\n        padding-bottom: 12px;\n        padding-left: 6px;\n        border-bottom: 1px solid #d9d9d9;\n        margin-bottom: 10px;\n        margin-top: 46px; }\n        .app-19078 .main table tbody .separator:first-child {\n          margin-top: 0px; }\n      .app-19078 .main table tbody .available {\n        margin-bottom: 20px; }\n      .app-19078 .main table tbody .values-text-input {\n        order: 0px;\n        border-bottom: 1px solid #e8e8e8;\n        border-radius: 0px;\n        width: 100%;\n        box-sizing: border-box;\n        box-shadow: none;\n        height: 31px; }\n      .app-19078 .main table tbody ul, .app-19078 .main table tbody li {\n        margin: 0;\n        padding: 0; }\n      .app-19078 .main table tbody ul {\n        overflow-y: hidden;\n        overflow-x: hidden; }\n      .app-19078 .main table tbody li {\n        border: 0; }\n        .app-19078 .main table tbody li a {\n          font-size: 13px;\n          display: block;\n          padding: 10px 6px;\n          position: relative;\n          color: #333;\n          white-space: nowrap;\n          overflow: hidden;\n          text-overflow: ellipsis; }\n        .app-19078 .main table tbody li.active, .app-19078 .main table tbody li:hover {\n          background-color: #f5f5f5; }\n        .app-19078 .main table tbody li.active a, .app-19078 .main table tbody li a.assigned {\n          font-weight: bold; }\n        .app-19078 .main table tbody li.active a:after, .app-19078 .main table tbody li.selected a:after {\n          color: #333;\n          display: block;\n          padding: 10px;\n          position: absolute;\n          right: 0;\n          top: 0; }\n        .app-19078 .main table tbody li.active a:after {\n          content: \"▸\"; }\n        .app-19078 .main table tbody li span[data-toggle=\"tooltip\"] {\n          position: relative;\n          top: 12px; }\n        .app-19078 .main table tbody li.selected input {\n          position: relative;\n          top: 10px;\n          right: 1px; }\n        .app-19078 .main table tbody li.selected .checkMark {\n          float: left;\n          position: relative;\n          top: 11px;\n          left: 6px; }\n        .app-19078 .main table tbody li.selected .ui-icon-alert {\n          position: relative;\n          right: 8px; }\n        .app-19078 .main table tbody li.unselectable a {\n          color: #CCC; }\n.app-19078 #snippetModal pre {\n  max-height: 150px;\n  overflow: scroll;\n  background-color: #efefef; }\n.app-19078 .modalRuleDisplay {\n  border: 1px solid #cccccc;\n  padding: 5px; }\n  .app-19078 .modalRuleDisplay h4, .app-19078 .modalRuleDisplay p {\n    background-color: #f6f6f6;\n    padding: 10px; }\n  .app-19078 .modalRuleDisplay h4 {\n    padding-bottom: 0em; }\n  .app-19078 .modalRuleDisplay p {\n    padding-top: 0.5em; }\n.app-19078 .enterpriseBackdrop {\n  width: 100%;\n  background: rgba(110, 110, 110, 0.5);\n  height: 100%;\n  position: absolute;\n  z-index: 10;\n  top: 0px; }\n.app-19078 #requiredWarningModal .faultyRules {\n  margin-top: 10px; }\n  .app-19078 #requiredWarningModal .faultyRules li.rule {\n    margin-bottom: 10px; }\n    .app-19078 #requiredWarningModal .faultyRules li.rule ul {\n      background-color: #f6f6f6;\n      margin-left: 0px;\n      padding-left: 10px;\n      padding-right: 10px; }\n      .app-19078 #requiredWarningModal .faultyRules li.rule ul li {\n        display: inline; }\n        .app-19078 #requiredWarningModal .faultyRules li.rule ul li:after {\n          content: \", \"; }\n        .app-19078 #requiredWarningModal .faultyRules li.rule ul li:last-child:after {\n          content: \"\"; }\n.app-19078 .enable-required, .app-19078 .disable-required {\n  float: right; }\n  .app-19078 .enable-required .enableRequired, .app-19078 .enable-required .disableRequired, .app-19078 .disable-required .enableRequired, .app-19078 .disable-required .disableRequired {\n    margin-left: 5px;\n    border: 1px solid #ccc;\n    padding: 2px 7px 2px 7px;\n    border-radius: 4px;\n    color: #666; }\n.app-19078 .requiredTag {\n  color: #ccc;\n  position: relative;\n  top: 12px;\n  font-size: 11px; }\n\u003c/style\u003e\n\u003cheader\u003e\n  \u003ch3\u003e{{setting \"name\"}}\u003c/h3\u003e\n\u003c/header\u003e\n\n\u003cdiv data-main class='cfa_navbar'\u003e\n  {{spinner}}\n\u003c/div\u003e\n\n\u003cfooter class=\"cfa_footer\"\u003e\n  \u003cdiv class=\"pane\"\u003e\n    \u003cbutton class=\"delete text-error deleteAll\"\u003e{{#if has_forms}}{{t \"rules.deleteAllForForm\"}}{{else}}{{t \"rules.deleteAll\"}}{{/if}}\u003c/button\u003e\n    \u003cdiv class=\"action-buttons pull-right\"\u003e\n      \u003cbutton class=\"btn cancel\"\u003e{{t \"rules.cancel\"}}\u003c/button\u003e\n      \u003cbutton class=\"btn btn-primary save\"\u003e{{t \"rules.save\"}}\u003c/button\u003e\n    \u003c/div\u003e\n  \u003c/div\u003e\n\u003c/footer\u003e","loading":"\u003cdiv class=\"loading\"\u003e{{spinner \"dotted\"}}\u003c/div\u003e","required_rule":"\u003cli class='rule'\u003e\n  \u003cdiv class=\"modalRuleDisplay\"\u003e\n    \u003ch4\u003e{{title}}\u003c/h4\u003e\n    \u003cp\u003e\n      \u003cul\u003e\n        {{#each fields}}\n          \u003cli\u003e{{#if required}}\u003cstrong\u003e{{text}}\u003c/strong\u003e{{else}}{{text}}{{/if}}\u003c/li\u003e\n        {{/each}}\n      \u003c/ul\u003e\n    \u003c/p\u003e\n  \u003c/div\u003e\n\u003c/li\u003e","rules":"\u003ch4 class=\"rules_summary_title\"\u003e{{t \"rules.summary\" count=count}}\u003c/h4\u003e\n\u003cul class=\"unstyled global\"\u003e\n{{#fields}}\n  \u003cli class=\"rule\" data-id=\"{{id}}\"\u003e\n    \u003cdiv class='ruleTitle'\u003e\n      \u003cdiv class=\"pull-right\"\u003e\n        \u003ca href=\"#\" class=\"collapse_menu\" value=\"{{id}}\"\u003e\n          \u003cspan class=\"ui-icon {{#unless toCollapse}}ui-icon-triangle-1-e{{else}}ui-icon-triangle-1-s{{/unless}}\"\u003e\u003c/span\u003e\n        \u003c/a\u003e\n      \u003c/div\u003e\n      \u003ci class='icon-arrow-right'\u003e\u003c/i\u003e \u003ca class=\"field\"\u003e{{name}}\u003c/a\u003e\n    \u003c/div\u003e\n    \u003cul class=\"unstyled {{#unless collapsed}}collapsed{{/unless}}\"\u003e\n    {{#rules}}\n      \u003cli class=\"value{{#if selected}} selectedRule hardSelect{{/if}}\"\u003e\n      \u003ca class='ruleItem' value='{{index}}'\u003e\u003ci class='icon-arrow-right'\u003e\u003c/i\u003e {{valueText}}\u003c/a\u003e\n          \u003cdiv class=\"pull-right\"\u003e\n            \u003ca class='deleteRule {{#unless selected}}hide{{/unless}}' value='{{index}}'\u003e×\u003c/a\u003e\n          \u003c/div\u003e\n          \u003cp\u003e\u003ci class='icon-arrow-right'\u003e\u003c/i\u003e \u003cem\u003e{{fieldsText}}\u003c/em\u003e\u003c/p\u003e\n      \u003c/li\u003e\n    {{/rules}}\n    \u003c/ul\u003e\n  \u003c/li\u003e\n{{else}}\n\u003cli class=\"empty\"\u003e{{t \"rules.empty\"}}\u003c/li\u003e\n{{/fields}}\n\u003c/ul\u003e","select_fields":"{{#if total}}\n    \u003cdiv class='separator'\u003e\n      {{#if hasSelected}}\n        \u003cdiv class='enable-required'\u003e\n          \u003ca class='enableRequired'\u003e{{t \"required.enable\"}}\u003c/a\u003e\n        \u003c/div\u003e\n        \u003cdiv class='disable-required' style='display: none'\u003e\n          \u003ca class='disableRequired'\u003e{{t \"required.disable\"}}\u003c/a\u003e\n        \u003c/div\u003e\n      {{/if}}\n      {{t \"separators.available\"}}\n    \u003c/div\u003e\n\n    \u003cul\u003e\n      {{#selectableFields}}\n        \u003cli class=\"{{#if selected}}selected{{/if}} {{#if unselectable}}unselectable{{/if}} {{#if required}}required{{/if}}\"\u003e\n          {{#if required}}\n            \u003cspan class='requiredTag pull-right'\u003e{{t \"required.required\"}}\u003c/span\u003e\n          {{/if}}\n          {{#if selected}}\n            \u003ci class='icon-ok checkMark'/\u003e\n            \u003cinput type='checkbox' class='pull-right' style='display: none' data-value=\"{{id}}\"\u003e\n          {{/if}}\n          \u003ca value=\"{{id}}\"\n             class=\"selectedField{{#if selected}} assigned{{/if}}\"\u003e\n               {{name}}\n          \u003c/a\u003e\n        \u003c/li\u003e\n      {{/selectableFields}}\n    \u003c/ul\u003e\n\n\n    {{#if unselectableFields.length}}\n      \u003cdiv class='separator'\u003e{{t \"separators.unavailable\"}}\u003c/div\u003e\n\n      \u003cul class='unavailable'\u003e\n        {{#unselectableFields}}\n          \u003cli class=\"unselectable\"\u003e\n            \u003ca value=\"{{id}}\"\n               class=\"selectedField\"\u003e\n                 {{name}}\n            \u003c/a\u003e\n          \u003c/li\u003e\n        {{/unselectableFields}}\n      \u003c/ul\u003e\n    {{/if}}\n{{/if}}","values":"{{#if values.length}}\n  \u003cdiv class='separator'\u003e{{t \"separators.available\"}}\u003c/div\u003e\n\n  \u003cul\u003e\n    {{#values}}\n      \u003cli {{#if selected}}class=\"active\"{{/if}}\u003e\n        \u003ca value=\"{{value}}\" class=\"value{{#if assigned}} assigned{{/if}}\"\u003e{{name}}\u003c/a\u003e\n      \u003c/li\u003e\n    {{/values}}\n  \u003c/ul\u003e\n{{/if}}"},
    frameworkVersion: "1.0"
  });

ZendeskApps["Conditional Fields"] = app;


    if (ZendeskApps["Notification App"]) {
      ZendeskApps["Notification App"].install({"id":1044688,"app_id":52161,"app_name":"Notification App","enabled":true,"settings":{"name":"Notification App","title":"Notification App"},"requirements":[],"updated_at":"2016-09-07T19:12:11Z","created_at":"2016-09-07T19:12:11Z"});
    }
    if (ZendeskApps["Submission Blocker"]) {
      ZendeskApps["Submission Blocker"].install({"id":1045028,"app_id":97110,"app_name":"Submission Blocker","enabled":true,"settings":{"name":"Submission Blocker","title":"Submission Blocker","terms":"011777151,445190514999"},"requirements":[],"updated_at":"2016-09-09T20:51:31Z","created_at":"2016-09-07T20:12:52Z"});
    }
    if (ZendeskApps["Quickie"]) {
      ZendeskApps["Quickie"].install({"id":1114307,"app_id":33631,"app_name":"Quickie","enabled":true,"settings":{"miscFolderName":"Misc","miscPosBottom":true,"personalFolderName":"Personal","personalFolderPosBottom":true,"name":"Lovely Views","title":"Lovely Views","noMiscFolder":false,"notPersonal":false},"requirements":[],"updated_at":"2016-09-13T20:25:10Z","created_at":"2016-09-13T20:23:58Z"});
    }
    if (ZendeskApps["Resources Search"]) {
      ZendeskApps["Resources Search"].install({"id":1033708,"app_id":96853,"app_name":"Resources Search","enabled":true,"settings":{"name":"Resources Search","title":"Resources Search"},"requirements":[],"updated_at":"2016-09-15T18:51:01Z","created_at":"2016-09-02T22:42:11Z"});
    }
    if (ZendeskApps["Undo Send"]) {
      ZendeskApps["Undo Send"].install({"id":1056148,"app_id":97431,"app_name":"Undo Send","enabled":true,"settings":{"allow_agents_choose_timeout":true,"name":"Undo Send","title":"Undo Send"},"requirements":[],"updated_at":"2016-09-19T14:49:45Z","created_at":"2016-09-12T17:48:15Z"});
    }
    if (ZendeskApps["User Data"]) {
      ZendeskApps["User Data"].install({"id":1048708,"app_id":6536,"app_name":"User Data","enabled":true,"settings":{"orgFieldsActivated":"true","name":"User Data","title":"User Data","selectedFields":"[]","orgFields":"[\"merchant_country\",\"managed_account\",\"prod_id\",\"merchant_account_provider\",\"account_manager\",\"active_risk_case\",\"application_status\",\"salesforce_unique_id\",\"marketplace\",\"merchant_account_number\",\"merchant_public_id\",\"sales_rep\",\"gateway_only\",\"##builtin_details\",\"##builtin_notes\"]"},"requirements":[],"updated_at":"2016-09-19T14:50:09Z","created_at":"2016-09-08T21:34:34Z"});
    }
    if (ZendeskApps["Assignment Control"]) {
      ZendeskApps["Assignment Control"].install({"id":1048688,"app_id":52174,"app_name":"Assignment Control","enabled":true,"settings":{"name":"Assignment Control","title":"Assignment Control","hidden_user_ids":"8413198447","hidden_group_ids":null,"targeted_user_ids":null,"targeted_user_tags":null,"targeted_organization_ids":null,"targeted_group_ids":null},"requirements":[],"updated_at":"2016-09-26T18:42:43Z","created_at":"2016-09-08T21:29:44Z"});
    }
    if (ZendeskApps["Advanced Search"]) {
      ZendeskApps["Advanced Search"].install({"id":1045328,"app_id":45270,"app_name":"Advanced Search","enabled":true,"settings":{"name":"Advanced Search","title":"Advanced Search"},"requirements":[],"updated_at":"2016-09-27T18:12:48Z","created_at":"2016-09-07T21:26:32Z"});
    }
    if (ZendeskApps["Ticket Redaction App"]) {
      ZendeskApps["Ticket Redaction App"].install({"id":1085328,"app_id":42515,"app_name":"Ticket Redaction App","enabled":true,"settings":{"name":"Redaction App","title":"Redaction App"},"requirements":[],"updated_at":"2016-09-29T22:11:34Z","created_at":"2016-09-19T15:59:05Z"});
    }
    if (ZendeskApps["Attachment List"]) {
      ZendeskApps["Attachment List"].install({"id":1183627,"app_id":84814,"app_name":"Attachment List","enabled":true,"settings":{"name":"Attachment List","title":"Attachment List"},"requirements":[],"updated_at":"2016-10-03T18:53:10Z","created_at":"2016-10-03T18:53:06Z"});
    }
    if (ZendeskApps["Ticket Field Manager"]) {
      ZendeskApps["Ticket Field Manager"].install({"id":1096827,"app_id":97112,"app_name":"Ticket Field Manager","enabled":true,"settings":{"name":"Ticket Field Manager","title":"Ticket Field Manager","hidden_fields":"custom_field_41082648,custom_field_41082628,custom_field_41619048","readonly_fields":"custom_field_35944067,custom_field_39397748,custom_field_35412967","readonly_fields_whitelist_tags":"admin","required_fields":null,"required_fields_whitelist_tags":null,"required_fields_whitelist_group_ids":null,"required_fields_whitelist_organization_ids":null,"hidden_fields_whitelist_tags":null,"hidden_fields_whitelist_group_ids":null,"hidden_fields_whitelist_organization_ids":null,"readonly_fields_whitelist_group_ids":null,"readonly_fields_whitelist_organization_ids":null},"requirements":[],"updated_at":"2016-10-03T19:36:40Z","created_at":"2016-09-07T20:18:07Z"});
    }
    if (ZendeskApps["Conditional Fields"]) {
      ZendeskApps["Conditional Fields"].install({"id":1102847,"app_id":19078,"app_name":"Conditional Fields","enabled":true,"settings":{"disable_conflicts_prevention":false,"name":"Conditional Fields","title":"Conditional Fields","rules":"[{\"field\":36352708,\"value\":\"yes\",\"select\":[41329907],\"formId\":278927,\"dirty\":false,\"creationDate\":1473434173874,\"requireds\":[],\"index\":0,\"valueText\":\"Yes\",\"fieldsText\":\"Future Feature Request Notes\",\"selected\":false},{\"field\":36352708,\"value\":\"yes\",\"select\":[41329907],\"formId\":278947,\"dirty\":false,\"creationDate\":1473434564715,\"requireds\":[],\"index\":1,\"valueText\":\"Yes\",\"fieldsText\":\"Future Feature Request Notes\",\"selected\":false},{\"field\":36352708,\"value\":\"yes\",\"select\":[41329907],\"formId\":305607,\"dirty\":false,\"creationDate\":1473434765494,\"requireds\":[],\"index\":2,\"valueText\":\"Yes\",\"fieldsText\":\"Future Feature Request Notes\",\"selected\":false},{\"field\":36352708,\"value\":\"yes\",\"select\":[41329907],\"formId\":305627,\"dirty\":false,\"creationDate\":1473434757817,\"requireds\":[],\"index\":3,\"valueText\":\"Yes\",\"fieldsText\":\"Future Feature Request Notes\",\"selected\":false},{\"field\":36352708,\"value\":\"yes\",\"select\":[41329907],\"formId\":308167,\"dirty\":false,\"creationDate\":1474994989590,\"requireds\":[],\"index\":4,\"valueText\":\"Yes\",\"fieldsText\":\"Future Feature Request Notes\",\"selected\":false},{\"field\":36352708,\"value\":\"yes\",\"select\":[41329907],\"formId\":397188,\"dirty\":false,\"creationDate\":1473434612157,\"requireds\":[],\"index\":5,\"valueText\":\"Yes\",\"fieldsText\":\"Future Feature Request Notes\",\"selected\":false},{\"field\":36352708,\"value\":\"yes\",\"select\":[41329907],\"formId\":397208,\"dirty\":false,\"creationDate\":1473435058624,\"requireds\":[],\"index\":6,\"valueText\":\"Yes\",\"fieldsText\":\"Future Feature Request Notes\",\"selected\":false},{\"field\":36352708,\"value\":\"yes\",\"select\":[41329907],\"formId\":306167,\"dirty\":true,\"creationDate\":1475534212250,\"requireds\":[],\"index\":7,\"valueText\":\"Yes\",\"fieldsText\":\"Future Feature Request Notes\",\"selected\":false},{\"field\":39161828,\"value\":\"acc_manconif_oth\",\"select\":[42453207],\"formId\":278947,\"dirty\":false,\"creationDate\":1475532291070,\"requireds\":[],\"index\":8,\"valueText\":\"Manual Configuration » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":39161828,\"value\":\"acc_nonmerc_cardhold_oth\",\"select\":[42453207],\"formId\":278947,\"dirty\":false,\"creationDate\":1475532189876,\"requireds\":[],\"index\":9,\"valueText\":\"Non Merchant » Card Holder » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":39161828,\"value\":\"acc_nonmerc_other\",\"select\":[42453207],\"formId\":278947,\"dirty\":false,\"creationDate\":1475532192662,\"requireds\":[],\"index\":10,\"valueText\":\"Non Merchant » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":39161828,\"value\":\"acc_nonmerc_pros_oth\",\"select\":[42453207],\"formId\":278947,\"dirty\":false,\"creationDate\":1475532195150,\"requireds\":[],\"index\":11,\"valueText\":\"Non Merchant » Prospective » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":39161828,\"value\":\"acc_obuw_existmerc_mutlimerch_other\",\"select\":[42453207],\"formId\":278947,\"dirty\":false,\"creationDate\":1475532250224,\"requireds\":[],\"index\":12,\"valueText\":\"Onboarding/Underwriting » Existing Merchant Underwriting » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":39161828,\"value\":\"acc_obuw_existmerc_other\",\"select\":[42453207],\"formId\":278947,\"dirty\":false,\"creationDate\":1475532217104,\"requireds\":[],\"index\":13,\"valueText\":\"Onboarding/Underwriting » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":39161828,\"value\":\"acc_obuw_submerc_oth\",\"select\":[42453207],\"formId\":278947,\"dirty\":false,\"creationDate\":1475532204894,\"requireds\":[],\"index\":14,\"valueText\":\"Onboarding/Underwriting » Sub-merchant » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":39161828,\"value\":\"acc_oth\",\"select\":[42453207],\"formId\":278947,\"dirty\":false,\"creationDate\":1475532384982,\"requireds\":[],\"index\":15,\"valueText\":\"Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":true},{\"field\":39161828,\"value\":\"acc_pric_fee_oth\",\"select\":[42453207],\"formId\":278947,\"dirty\":false,\"creationDate\":1475532256007,\"requireds\":[],\"index\":16,\"valueText\":\"Pricing » Fees » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":39161828,\"value\":\"acc_pric_pricadj_oth\",\"select\":[42453207],\"formId\":278947,\"dirty\":false,\"creationDate\":1475532259784,\"requireds\":[],\"index\":17,\"valueText\":\"Pricing » Pricing Adjustment » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":39161828,\"value\":\"acc_pricing_oth\",\"select\":[42453207],\"formId\":278947,\"dirty\":false,\"creationDate\":1475532264094,\"requireds\":[],\"index\":18,\"valueText\":\"Pricing » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":39161828,\"value\":\"acc_prodtype_3ds_other\",\"select\":[42453207],\"formId\":278947,\"dirty\":false,\"creationDate\":1475532375214,\"requireds\":[],\"index\":19,\"valueText\":\"Product Type » 3DS » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":39161828,\"value\":\"acc_prodtype_ach_other\",\"select\":[42453207],\"formId\":278947,\"dirty\":false,\"creationDate\":1475532329942,\"requireds\":[],\"index\":20,\"valueText\":\"Product Type » ACH » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":39161828,\"value\":\"acc_prodtype_applepay_other\",\"select\":[42453207],\"formId\":278947,\"dirty\":false,\"creationDate\":1475532318974,\"requireds\":[],\"index\":21,\"valueText\":\"Product Type » Apple Pay » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":39161828,\"value\":\"acc_prodtype_coinbase\",\"select\":[42453207],\"formId\":278947,\"dirty\":false,\"creationDate\":1475532350758,\"requireds\":[],\"index\":22,\"valueText\":\"Product Type » Coinbase/Bitcoin » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":39161828,\"value\":\"acc_prodtype_config_other\",\"select\":[42453207],\"formId\":278947,\"dirty\":false,\"creationDate\":1475532371006,\"requireds\":[],\"index\":23,\"valueText\":\"Product Type » Configuration » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":39161828,\"value\":\"acc_prodtype_droidpay_other\",\"select\":[42453207],\"formId\":278947,\"dirty\":false,\"creationDate\":1475532323022,\"requireds\":[],\"index\":24,\"valueText\":\"Product Type » Android Pay » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":39161828,\"value\":\"acc_prodtype_fraud_other\",\"select\":[42453207],\"formId\":278947,\"dirty\":false,\"creationDate\":1475532365710,\"requireds\":[],\"index\":25,\"valueText\":\"Product Type » Fraud Tools » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":39161828,\"value\":\"acc_prodtype_other\",\"select\":[42453207],\"formId\":278947,\"dirty\":false,\"creationDate\":1475532380255,\"requireds\":[],\"index\":26,\"valueText\":\"Product Type » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":39161828,\"value\":\"acc_prodtype_pwpp_other\",\"select\":[42453207],\"formId\":278947,\"dirty\":false,\"creationDate\":1475532311718,\"requireds\":[],\"index\":27,\"valueText\":\"Product Type » PwPP » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":39161828,\"value\":\"acc_prodtype_pwv_other\",\"select\":[42453207],\"formId\":278947,\"dirty\":false,\"creationDate\":1475532334486,\"requireds\":[],\"index\":28,\"valueText\":\"Product Type » Pay with Venmo » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":39161828,\"value\":\"acc_prodtype_sepa_other\",\"select\":[42453207],\"formId\":278947,\"dirty\":false,\"creationDate\":1475532355926,\"requireds\":[],\"index\":29,\"valueText\":\"Product Type » SEPA » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":39161828,\"value\":\"acc_prodtype_unionpay_other\",\"select\":[42453207],\"formId\":278947,\"dirty\":false,\"creationDate\":1475532343574,\"requireds\":[],\"index\":30,\"valueText\":\"Product Type » Union Pay » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":39161828,\"value\":\"acc_reconcil_fundist_venpay\",\"select\":[42453207],\"formId\":278947,\"dirty\":false,\"creationDate\":1475532267598,\"requireds\":[],\"index\":31,\"valueText\":\"Reconciliation » Funding/Disbursement » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":39161828,\"value\":\"acc_reconcil_oth\",\"select\":[42453207],\"formId\":278947,\"dirty\":false,\"creationDate\":1475532286030,\"requireds\":[],\"index\":32,\"valueText\":\"Reconciliation » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":39161828,\"value\":\"acc_reconcil_srch_oth\",\"select\":[42453207],\"formId\":278947,\"dirty\":false,\"creationDate\":1475532272846,\"requireds\":[],\"index\":33,\"valueText\":\"Reconciliation » Search » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":39161828,\"value\":\"acc_reconcil_srchrpt_oth\",\"select\":[42453207],\"formId\":278947,\"dirty\":false,\"creationDate\":1475532282391,\"requireds\":[],\"index\":34,\"valueText\":\"Reconciliation » Search/Reporting » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":39161828,\"value\":\"acc_reconcil_state_oth\",\"select\":[42453207],\"formId\":278947,\"dirty\":false,\"creationDate\":1475532276726,\"requireds\":[],\"index\":35,\"valueText\":\"Reconciliation » Statement » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":39161828,\"value\":\"acc_risk_chargebac_oth\",\"select\":[42453207],\"formId\":278947,\"dirty\":false,\"creationDate\":1475532296262,\"requireds\":[],\"index\":36,\"valueText\":\"Risk Issues » Chargebacks » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":39161828,\"value\":\"acc_risk_oth\",\"select\":[42453207],\"formId\":278947,\"dirty\":false,\"creationDate\":1475532301582,\"requireds\":[],\"index\":37,\"valueText\":\"Risk Issues » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":39161828,\"value\":\"acc_thrdprty_oth\",\"select\":[42453207],\"formId\":278947,\"dirty\":false,\"creationDate\":1475532307782,\"requireds\":[],\"index\":38,\"valueText\":\"Third Party » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":40935188,\"value\":\"nas_geninquir_3rdpart_other\",\"select\":[42453207],\"formId\":305607,\"dirty\":false,\"creationDate\":1475533424190,\"requireds\":[],\"index\":39,\"valueText\":\"General Inquiry » Shopping Cart/Third Party » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":40935188,\"value\":\"nas_geninquir_other\",\"select\":[42453207],\"formId\":305607,\"dirty\":false,\"creationDate\":1475533437022,\"requireds\":[],\"index\":40,\"valueText\":\"General Inquiry » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":40935188,\"value\":\"nas_geninquir_paymeth_other\",\"select\":[42453207],\"formId\":305607,\"dirty\":false,\"creationDate\":1475533433607,\"requireds\":[],\"index\":41,\"valueText\":\"General Inquiry » Payment Methods » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":40935188,\"value\":\"nas_geninquir_pricing_other\",\"select\":[42453207],\"formId\":305607,\"dirty\":false,\"creationDate\":1475533418371,\"requireds\":[],\"index\":42,\"valueText\":\"General Inquiry » Pricing » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":40935188,\"value\":\"nas_gwonly_other\",\"select\":[42453207],\"formId\":305607,\"dirty\":false,\"creationDate\":1475533415302,\"requireds\":[],\"index\":43,\"valueText\":\"Gateway Only » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":40935188,\"value\":\"nas_moneris_appclose_other\",\"select\":[42453207],\"formId\":305607,\"dirty\":false,\"creationDate\":1475533404968,\"requireds\":[],\"index\":44,\"valueText\":\"Moneris » Application Closure » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":40935188,\"value\":\"nas_moneris_appinquir_other\",\"select\":[42453207],\"formId\":305607,\"dirty\":false,\"creationDate\":1475533400009,\"requireds\":[],\"index\":45,\"valueText\":\"Moneris » Application Inquiry » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":40935188,\"value\":\"nas_moneris_appreview_other\",\"select\":[42453207],\"formId\":305607,\"dirty\":false,\"creationDate\":1475533401790,\"requireds\":[],\"index\":46,\"valueText\":\"Moneris » Application Review » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":40935188,\"value\":\"nas_moneris_decline_other\",\"select\":[42453207],\"formId\":305607,\"dirty\":false,\"creationDate\":1475533408286,\"requireds\":[],\"index\":47,\"valueText\":\"Moneris » Decline » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":40935188,\"value\":\"nas_moneris_other\",\"select\":[42453207],\"formId\":305607,\"dirty\":false,\"creationDate\":1475533411037,\"requireds\":[],\"index\":48,\"valueText\":\"Moneris » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":40935188,\"value\":\"nas_other\",\"select\":[42453207],\"formId\":305607,\"dirty\":false,\"creationDate\":1475533446430,\"requireds\":[],\"index\":49,\"valueText\":\"Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":true},{\"field\":40935188,\"value\":\"nas_pp_other\",\"select\":[42453207],\"formId\":305607,\"dirty\":false,\"creationDate\":1475533444006,\"requireds\":[],\"index\":50,\"valueText\":\"PayPal » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":40935188,\"value\":\"nas_pp_ppreptask_other\",\"select\":[42453207],\"formId\":305607,\"dirty\":false,\"creationDate\":1475533441421,\"requireds\":[],\"index\":51,\"valueText\":\"PayPal » PayPal Rep Task/Inquiry » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":40935188,\"value\":\"nas_wells_appclose_other\",\"select\":[42453207],\"formId\":305607,\"dirty\":false,\"creationDate\":1475533391615,\"requireds\":[],\"index\":52,\"valueText\":\"Wells » Application Closure » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":40935188,\"value\":\"nas_wells_appinquir_other\",\"select\":[42453207],\"formId\":305607,\"dirty\":false,\"creationDate\":1475533387543,\"requireds\":[],\"index\":53,\"valueText\":\"Wells » Application Inquiry » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":40935188,\"value\":\"nas_wells_appreview_other\",\"select\":[42453207],\"formId\":305607,\"dirty\":false,\"creationDate\":1475533390349,\"requireds\":[],\"index\":54,\"valueText\":\"Wells » Application Review » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":40935188,\"value\":\"nas_wells_decline_other\",\"select\":[42453207],\"formId\":305607,\"dirty\":false,\"creationDate\":1475533393478,\"requireds\":[],\"index\":55,\"valueText\":\"Wells » Decline » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":40935188,\"value\":\"nas_wells_other\",\"select\":[42453207],\"formId\":305607,\"dirty\":false,\"creationDate\":1475533397030,\"requireds\":[],\"index\":56,\"valueText\":\"Wells » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":40935188,\"value\":\"nas_wells_pricing_other\",\"select\":[42453207],\"formId\":305607,\"dirty\":false,\"creationDate\":1475533388895,\"requireds\":[],\"index\":57,\"valueText\":\"Wells » Pricing » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":40935208,\"value\":\"doc_bankpart_other\",\"select\":[42453207],\"formId\":308167,\"dirty\":false,\"creationDate\":1475532669010,\"requireds\":[],\"index\":58,\"valueText\":\"Banking Partnerships » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":40935208,\"value\":\"doc_compcomm_other\",\"select\":[42453207],\"formId\":308167,\"dirty\":false,\"creationDate\":1475532674433,\"requireds\":[],\"index\":59,\"valueText\":\"Company Communication » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":40935208,\"value\":\"doc_externprod_content_oth\",\"select\":[42453207],\"formId\":308167,\"dirty\":false,\"creationDate\":1475532659937,\"requireds\":[],\"index\":60,\"valueText\":\"External Product » Content Corrections » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":40935208,\"value\":\"doc_externprod_new_othr\",\"select\":[42453207],\"formId\":308167,\"dirty\":false,\"creationDate\":1475532658417,\"requireds\":[],\"index\":61,\"valueText\":\"External Product » New Product » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":40935208,\"value\":\"doc_externprod_oth\",\"select\":[42453207],\"formId\":308167,\"dirty\":false,\"creationDate\":1475532661409,\"requireds\":[],\"index\":62,\"valueText\":\"External Product » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":40935208,\"value\":\"doc_externprod_prodchng_oth\",\"select\":[42453207],\"formId\":308167,\"dirty\":false,\"creationDate\":1475532657161,\"requireds\":[],\"index\":63,\"valueText\":\"External Product » Product Changes » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":40935208,\"value\":\"doc_internprod_othr\",\"select\":[42453207],\"formId\":308167,\"dirty\":false,\"creationDate\":1475532654954,\"requireds\":[],\"index\":64,\"valueText\":\"Internal Product » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":40935208,\"value\":\"doc_other\",\"select\":[42453207],\"formId\":308167,\"dirty\":false,\"creationDate\":1475532680593,\"requireds\":[],\"index\":65,\"valueText\":\"Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":true},{\"field\":40935208,\"value\":\"doc_procesknow_oth\",\"select\":[42453207],\"formId\":308167,\"dirty\":false,\"creationDate\":1475532665145,\"requireds\":[],\"index\":66,\"valueText\":\"Internal Processes and Knowledge » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":40935208,\"value\":\"doc_wikireq_othr\",\"select\":[42453207],\"formId\":308167,\"dirty\":false,\"creationDate\":1475532678032,\"requireds\":[],\"index\":67,\"valueText\":\"Wiki Requests » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":40943348,\"value\":\"fin_billing_other\",\"select\":[42453207],\"formId\":398028,\"dirty\":false,\"creationDate\":1475532704171,\"requireds\":[],\"index\":68,\"valueText\":\"Billing » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":40943348,\"value\":\"fin_btfund_other\",\"select\":[42453207],\"formId\":398028,\"dirty\":false,\"creationDate\":1475532709897,\"requireds\":[],\"index\":69,\"valueText\":\"Braintree Funded » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":40943348,\"value\":\"fin_nonbtfund_other\",\"select\":[42453207],\"formId\":398028,\"dirty\":false,\"creationDate\":1475532712961,\"requireds\":[],\"index\":70,\"valueText\":\"Non Braintree Funded » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":40943348,\"value\":\"fin_other\",\"select\":[42453207],\"formId\":398028,\"dirty\":false,\"creationDate\":1475532716025,\"requireds\":[],\"index\":71,\"valueText\":\"Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":true},{\"field\":40943348,\"value\":\"fin_pricing_adjust_other\",\"select\":[42453207],\"formId\":398028,\"dirty\":false,\"creationDate\":1475532706113,\"requireds\":[],\"index\":72,\"valueText\":\"Pricing » Pricing Adjustment » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":40943348,\"value\":\"fin_pricing_fees_other\",\"select\":[42453207],\"formId\":398028,\"dirty\":false,\"creationDate\":1475532700129,\"requireds\":[],\"index\":73,\"valueText\":\"Pricing » Fees (question) » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":40943348,\"value\":\"fin_pricing_review_other\",\"select\":[42453207],\"formId\":398028,\"dirty\":false,\"creationDate\":1475532698305,\"requireds\":[],\"index\":74,\"valueText\":\"Pricing » Pricing Review » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028547,\"value\":\"mms_monerapp_othr\",\"select\":[42453207],\"formId\":397188,\"dirty\":false,\"creationDate\":1475533851143,\"requireds\":[],\"index\":75,\"valueText\":\"Moneris Application » Moneris Application(s) Attached » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028547,\"value\":\"mms_onb_othr\",\"select\":[42453207],\"formId\":397188,\"dirty\":false,\"creationDate\":1475533817126,\"requireds\":[],\"index\":76,\"valueText\":\"Onboarding Docs » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028547,\"value\":\"mms_other\",\"select\":[42453207],\"formId\":397188,\"dirty\":false,\"creationDate\":1475533854198,\"requireds\":[],\"index\":77,\"valueText\":\"Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":true},{\"field\":41028547,\"value\":\"mms_pp_othr\",\"select\":[42453207],\"formId\":397188,\"dirty\":false,\"creationDate\":1475533852773,\"requireds\":[],\"index\":78,\"valueText\":\"PayPal » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028547,\"value\":\"mms_pric_agreattach_other\",\"select\":[42453207],\"formId\":397188,\"dirty\":false,\"creationDate\":1475533814374,\"requireds\":[],\"index\":79,\"valueText\":\"Pricing » Custom Pricing Agreement Attached » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028547,\"value\":\"mms_pric_othr\",\"select\":[42453207],\"formId\":397188,\"dirty\":false,\"creationDate\":1475533815750,\"requireds\":[],\"index\":80,\"valueText\":\"Pricing » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028567,\"value\":\"ins_apac_acctset_other\",\"select\":[42453207],\"formId\":305627,\"dirty\":false,\"creationDate\":1475532932836,\"requireds\":[],\"index\":81,\"valueText\":\"APAC Application » Account Setup » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028567,\"value\":\"ins_apac_appclose_other\",\"select\":[42453207],\"formId\":305627,\"dirty\":false,\"creationDate\":1475532940030,\"requireds\":[],\"index\":82,\"valueText\":\"APAC Application » Application Closure » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028567,\"value\":\"ins_apac_appreview_other\",\"select\":[42453207],\"formId\":305627,\"dirty\":false,\"creationDate\":1475532937166,\"requireds\":[],\"index\":83,\"valueText\":\"APAC Application » Application Review » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028567,\"value\":\"ins_apac_other\",\"select\":[42453207],\"formId\":305627,\"dirty\":false,\"creationDate\":1475532941862,\"requireds\":[],\"index\":84,\"valueText\":\"APAC Application » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028567,\"value\":\"ins_emea_acctset_other\",\"select\":[42453207],\"formId\":305627,\"dirty\":false,\"creationDate\":1475532926622,\"requireds\":[],\"index\":85,\"valueText\":\"EMEA Application » Account Setup » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028567,\"value\":\"ins_emea_appclose_other\",\"select\":[42453207],\"formId\":305627,\"dirty\":false,\"creationDate\":1475532929205,\"requireds\":[],\"index\":86,\"valueText\":\"EMEA Application » Application Closure » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028567,\"value\":\"ins_emea_appreview_other\",\"select\":[42453207],\"formId\":305627,\"dirty\":false,\"creationDate\":1475532927767,\"requireds\":[],\"index\":87,\"valueText\":\"EMEA Application » Application Review » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028567,\"value\":\"ins_emea_other\",\"select\":[42453207],\"formId\":305627,\"dirty\":false,\"creationDate\":1475532931036,\"requireds\":[],\"index\":88,\"valueText\":\"EMEA Application » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028567,\"value\":\"ins_inquir_apac_other\",\"select\":[42453207],\"formId\":305627,\"dirty\":false,\"creationDate\":1475532952862,\"requireds\":[],\"index\":89,\"valueText\":\"Inquiry » APAC » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028567,\"value\":\"ins_inquir_emea_other\",\"select\":[42453207],\"formId\":305627,\"dirty\":false,\"creationDate\":1475532947446,\"requireds\":[],\"index\":90,\"valueText\":\"Inquiry » EMEA » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028567,\"value\":\"ins_inquir_other\",\"select\":[42453207],\"formId\":305627,\"dirty\":false,\"creationDate\":1475532955670,\"requireds\":[],\"index\":91,\"valueText\":\"Inquiry » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028567,\"value\":\"ins_other\",\"select\":[42453207],\"formId\":305627,\"dirty\":false,\"creationDate\":1475532957926,\"requireds\":[],\"index\":92,\"valueText\":\"Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":true},{\"field\":41028587,\"value\":\"ti_1datagma_other\",\"select\":[42453207],\"formId\":306167,\"dirty\":false,\"creationDate\":1475533907982,\"requireds\":[],\"index\":93,\"valueText\":\"FirstData-GMA » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028587,\"value\":\"ti_1datawels_other\",\"select\":[42453207],\"formId\":306167,\"dirty\":false,\"creationDate\":1475533906342,\"requireds\":[],\"index\":94,\"valueText\":\"FirstData- Wells » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028587,\"value\":\"ti_1datawels_ptsrejec_other\",\"select\":[42453207],\"formId\":306167,\"dirty\":false,\"creationDate\":1475533904590,\"requireds\":[],\"index\":95,\"valueText\":\"FirstData- Wells » PTS Rejected » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028587,\"value\":\"ti_adyen_other\",\"select\":[42453207],\"formId\":306167,\"dirty\":false,\"creationDate\":1475533915702,\"requireds\":[],\"index\":96,\"valueText\":\"Adyen » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028587,\"value\":\"ti_aib_batrchrej_other\",\"select\":[42453207],\"formId\":306167,\"dirty\":false,\"creationDate\":1475533910014,\"requireds\":[],\"index\":97,\"valueText\":\"AIB » Batch Rejects » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028587,\"value\":\"ti_aib_other\",\"select\":[42453207],\"formId\":306167,\"dirty\":false,\"creationDate\":1475533912662,\"requireds\":[],\"index\":98,\"valueText\":\"AIB » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028587,\"value\":\"ti_amexexprs_batchrjct_other\",\"select\":[42453207],\"formId\":306167,\"dirty\":false,\"creationDate\":1475533951677,\"requireds\":[],\"index\":99,\"valueText\":\"American Express » Batch Rejection » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028587,\"value\":\"ti_amexexprs_other\",\"select\":[42453207],\"formId\":306167,\"dirty\":false,\"creationDate\":1475533954300,\"requireds\":[],\"index\":100,\"valueText\":\"American Express » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028587,\"value\":\"ti_chase_other\",\"select\":[42453207],\"formId\":306167,\"dirty\":false,\"creationDate\":1475533931262,\"requireds\":[],\"index\":101,\"valueText\":\"Chase » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028587,\"value\":\"ti_gwo_missingsettle_other\",\"select\":[42453207],\"formId\":306167,\"dirty\":false,\"creationDate\":1475533935814,\"requireds\":[],\"index\":102,\"valueText\":\"GWO » Missing Settlement Response » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028587,\"value\":\"ti_gwo_other\",\"select\":[42453207],\"formId\":306167,\"dirty\":false,\"creationDate\":1475533944190,\"requireds\":[],\"index\":103,\"valueText\":\"GWO » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028587,\"value\":\"ti_gwo_translevel_other\",\"select\":[42453207],\"formId\":306167,\"dirty\":false,\"creationDate\":1475533939534,\"requireds\":[],\"index\":104,\"valueText\":\"GWO » Transaction-level error » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028587,\"value\":\"ti_moneris_other\",\"select\":[42453207],\"formId\":306167,\"dirty\":false,\"creationDate\":1475533926220,\"requireds\":[],\"index\":105,\"valueText\":\"Moneris » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028587,\"value\":\"ti_nab_failedrefun_other\",\"select\":[42453207],\"formId\":306167,\"dirty\":false,\"creationDate\":1475533918727,\"requireds\":[],\"index\":106,\"valueText\":\"NAB » Failed Refund » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028587,\"value\":\"ti_nab_other\",\"select\":[42453207],\"formId\":306167,\"dirty\":false,\"creationDate\":1475533922694,\"requireds\":[],\"index\":107,\"valueText\":\"NAB » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028587,\"value\":\"ti_other\",\"select\":[42453207],\"formId\":306167,\"dirty\":false,\"creationDate\":1475533958736,\"requireds\":[],\"index\":108,\"valueText\":\"Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028587,\"value\":\"ti_pp_other\",\"select\":[42453207],\"formId\":306167,\"dirty\":false,\"creationDate\":1475533948493,\"requireds\":[],\"index\":109,\"valueText\":\"PayPal » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028607,\"value\":\"dis_disp_bankpartnot_other\",\"select\":[42453207],\"formId\":278967,\"dirty\":false,\"creationDate\":1475532468656,\"requireds\":[],\"index\":110,\"valueText\":\"Disputes » Bank Partner Notification » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028607,\"value\":\"dis_disp_crdbrand_other\",\"select\":[42453207],\"formId\":278967,\"dirty\":false,\"creationDate\":1475532472049,\"requireds\":[],\"index\":111,\"valueText\":\"Disputes » Card Brand Program Notification » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028607,\"value\":\"dis_disp_dispresps_other\",\"select\":[42453207],\"formId\":278967,\"dirty\":false,\"creationDate\":1475532466161,\"requireds\":[],\"index\":112,\"valueText\":\"Disputes » Dispute Response » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028607,\"value\":\"dis_disp_fraudpren_other\",\"select\":[42453207],\"formId\":278967,\"dirty\":false,\"creationDate\":1475532479437,\"requireds\":[],\"index\":113,\"valueText\":\"Disputes » Fraud Prevention » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028607,\"value\":\"dis_disp_inquir_other\",\"select\":[42453207],\"formId\":278967,\"dirty\":false,\"creationDate\":1475532475552,\"requireds\":[],\"index\":114,\"valueText\":\"Disputes » Inquiry » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028607,\"value\":\"dis_disp_other\",\"select\":[42453207],\"formId\":278967,\"dirty\":false,\"creationDate\":1475532485441,\"requireds\":[],\"index\":115,\"valueText\":\"Disputes » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028607,\"value\":\"dis_disp_status_other\",\"select\":[42453207],\"formId\":278967,\"dirty\":false,\"creationDate\":1475532464946,\"requireds\":[],\"index\":116,\"valueText\":\"Disputes » Status » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028607,\"value\":\"dis_nonmerch_law_other\",\"select\":[42453207],\"formId\":278967,\"dirty\":false,\"creationDate\":1475532460065,\"requireds\":[],\"index\":117,\"valueText\":\"Non Merchant » Law Enforcement » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028607,\"value\":\"dis_nonmerch_other\",\"select\":[42453207],\"formId\":278967,\"dirty\":false,\"creationDate\":1475532463399,\"requireds\":[],\"index\":118,\"valueText\":\"Non Merchant » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028607,\"value\":\"dis_nonmerch_pp_asst_other\",\"select\":[42453207],\"formId\":278967,\"dirty\":false,\"creationDate\":1475532461915,\"requireds\":[],\"index\":119,\"valueText\":\"Non Merchant » PayPal Assistance » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028607,\"value\":\"dis_other\",\"select\":[42453207],\"formId\":278967,\"dirty\":false,\"creationDate\":1475532488513,\"requireds\":[],\"index\":120,\"valueText\":\"Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":true},{\"field\":41028627,\"value\":\"gc_existmerc_btmerc_other\",\"select\":[42453207],\"formId\":369928,\"dirty\":false,\"creationDate\":1475532896646,\"requireds\":[],\"index\":121,\"valueText\":\"Existing Merchant Setup » Existing PP Merchant Underwriting » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028627,\"value\":\"gc_existmerc_other\",\"select\":[42453207],\"formId\":369928,\"dirty\":false,\"creationDate\":1475532913919,\"requireds\":[],\"index\":122,\"valueText\":\"Existing Merchant Setup » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028627,\"value\":\"gc_existmerc_pr_other\",\"select\":[42453207],\"formId\":369928,\"dirty\":false,\"creationDate\":1475532907871,\"requireds\":[],\"index\":123,\"valueText\":\"Existing Merchant Setup » Periodic Review » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028627,\"value\":\"gc_existmerc_reuw_other\",\"select\":[42453207],\"formId\":369928,\"dirty\":false,\"creationDate\":1475532911175,\"requireds\":[],\"index\":124,\"valueText\":\"Existing Merchant Setup » Re-Underwrite » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028627,\"value\":\"gc_existmerc_submerch_other\",\"select\":[42453207],\"formId\":369928,\"dirty\":false,\"creationDate\":1475532904030,\"requireds\":[],\"index\":125,\"valueText\":\"Existing Merchant Setup » Sub-merchant » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028627,\"value\":\"gc_newmercset_actsetup_other\",\"select\":[42453207],\"formId\":369928,\"dirty\":false,\"creationDate\":1475532848001,\"requireds\":[],\"index\":126,\"valueText\":\"New Merchant Setup » Account Setup » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028627,\"value\":\"gc_newmercset_declin_other\",\"select\":[42453207],\"formId\":369928,\"dirty\":false,\"creationDate\":1475532858221,\"requireds\":[],\"index\":127,\"valueText\":\"New Merchant Setup » Decline » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028627,\"value\":\"gc_newmercset_mercout_other\",\"select\":[42453207],\"formId\":369928,\"dirty\":false,\"creationDate\":1475532844095,\"requireds\":[],\"index\":128,\"valueText\":\"New Merchant Setup » Merchant Outreach » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028627,\"value\":\"gc_newmercset_other\",\"select\":[42453207],\"formId\":369928,\"dirty\":false,\"creationDate\":1475532866470,\"requireds\":[],\"index\":129,\"valueText\":\"New Merchant Setup » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028627,\"value\":\"gc_newmercset_ppact_other\",\"select\":[42453207],\"formId\":369928,\"dirty\":false,\"creationDate\":1475532852358,\"requireds\":[],\"index\":130,\"valueText\":\"New Merchant Setup » PP Account Setup » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028627,\"value\":\"gc_newmercset_pric_oth\",\"select\":[42453207],\"formId\":369928,\"dirty\":false,\"creationDate\":1475532737945,\"requireds\":[],\"index\":131,\"valueText\":\"New Merchant Setup » Pricing » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028627,\"value\":\"gc_newmercset_pwpp_other\",\"select\":[42453207],\"formId\":369928,\"dirty\":false,\"creationDate\":1475532862024,\"requireds\":[],\"index\":132,\"valueText\":\"New Merchant Setup » PWPP - Pay with Paypal » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028627,\"value\":\"gc_nonmerch_other\",\"select\":[42453207],\"formId\":369928,\"dirty\":false,\"creationDate\":1475532740849,\"requireds\":[],\"index\":133,\"valueText\":\"Non Merchant  » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028627,\"value\":\"gc_nonmerch_pp_other\",\"select\":[42453207],\"formId\":369928,\"dirty\":false,\"creationDate\":1475532739602,\"requireds\":[],\"index\":134,\"valueText\":\"Non Merchant  » PayPal » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028627,\"value\":\"gc_nonmerch_prospect_other\",\"select\":[42453207],\"formId\":369928,\"dirty\":false,\"creationDate\":1475532917566,\"requireds\":[],\"index\":135,\"valueText\":\"Non Merchant  » Prospective » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":true},{\"field\":41028627,\"value\":\"gc_other\",\"select\":[42453207],\"formId\":369928,\"dirty\":false,\"creationDate\":1475532742931,\"requireds\":[],\"index\":136,\"valueText\":\"Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028647,\"value\":\"onb_bnkptnr_adyen_other\",\"select\":[42453207],\"formId\":306147,\"dirty\":false,\"creationDate\":1475533536429,\"requireds\":[],\"index\":137,\"valueText\":\"Banking Partner » Adyen » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028647,\"value\":\"onb_bnkptnr_aibaibfun_other\",\"select\":[42453207],\"formId\":306147,\"dirty\":false,\"creationDate\":1475533512262,\"requireds\":[],\"index\":138,\"valueText\":\"Banking Partner » AIB - AIB Funded » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028647,\"value\":\"onb_bnkptnr_aibbtfun_other\",\"select\":[42453207],\"formId\":306147,\"dirty\":false,\"creationDate\":1475533509055,\"requireds\":[],\"index\":139,\"valueText\":\"Banking Partner » AIB - BT Funded » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028647,\"value\":\"onb_bnkptnr_chasefull_other\",\"select\":[42453207],\"formId\":306147,\"dirty\":false,\"creationDate\":1475533541190,\"requireds\":[],\"index\":140,\"valueText\":\"Banking Partner » Chase Full Stack » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028647,\"value\":\"onb_bnkptnr_fdapac_other\",\"select\":[42453207],\"formId\":306147,\"dirty\":false,\"creationDate\":1475533522350,\"requireds\":[],\"index\":141,\"valueText\":\"Banking Partner » FD-APAC » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028647,\"value\":\"onb_bnkptnr_gwo_other\",\"select\":[42453207],\"formId\":306147,\"dirty\":false,\"creationDate\":1475533533143,\"requireds\":[],\"index\":142,\"valueText\":\"Banking Partner » GWO » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028647,\"value\":\"onb_bnkptnr_moneris_other\",\"select\":[42453207],\"formId\":306147,\"dirty\":false,\"creationDate\":1475533528863,\"requireds\":[],\"index\":143,\"valueText\":\"Banking Partner » Moneris  » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028647,\"value\":\"onb_bnkptnr_nabbnz_other\",\"select\":[42453207],\"formId\":306147,\"dirty\":false,\"creationDate\":1475533505486,\"requireds\":[],\"index\":144,\"valueText\":\"Banking Partner » NAB / BNZ » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028647,\"value\":\"onb_bnkptnr_other\",\"select\":[42453207],\"formId\":306147,\"dirty\":false,\"creationDate\":1475533543935,\"requireds\":[],\"index\":145,\"valueText\":\"Banking Partner » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028647,\"value\":\"onb_bnkptnr_wells_other\",\"select\":[42453207],\"formId\":306147,\"dirty\":false,\"creationDate\":1475533516889,\"requireds\":[],\"index\":146,\"valueText\":\"Banking Partner » Wells » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028647,\"value\":\"onb_gwmove_adyen_other\",\"select\":[42453207],\"formId\":306147,\"dirty\":false,\"creationDate\":1475533594014,\"requireds\":[],\"index\":147,\"valueText\":\"Gateway Move » Adyen » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028647,\"value\":\"onb_gwmove_aib_other\",\"select\":[42453207],\"formId\":306147,\"dirty\":false,\"creationDate\":1475533577678,\"requireds\":[],\"index\":148,\"valueText\":\"Gateway Move » AIB » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028647,\"value\":\"onb_gwmove_fdapac_other\",\"select\":[42453207],\"formId\":306147,\"dirty\":false,\"creationDate\":1475533574990,\"requireds\":[],\"index\":149,\"valueText\":\"Gateway Move » FD-APAC » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028647,\"value\":\"onb_gwmove_moneris_other\",\"select\":[42453207],\"formId\":306147,\"dirty\":false,\"creationDate\":1475533581237,\"requireds\":[],\"index\":150,\"valueText\":\"Gateway Move » Moneris » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028647,\"value\":\"onb_gwmove_multimerch_other\",\"select\":[42453207],\"formId\":306147,\"dirty\":false,\"creationDate\":1475533566294,\"requireds\":[],\"index\":151,\"valueText\":\"Gateway Move » Multi-Merchant » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028647,\"value\":\"onb_gwmove_nab_other\",\"select\":[42453207],\"formId\":306147,\"dirty\":false,\"creationDate\":1475533586094,\"requireds\":[],\"index\":152,\"valueText\":\"Gateway Move » NAB » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028647,\"value\":\"onb_gwmove_other\",\"select\":[42453207],\"formId\":306147,\"dirty\":false,\"creationDate\":1475533597278,\"requireds\":[],\"index\":153,\"valueText\":\"Gateway Move » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028647,\"value\":\"onb_gwmove_pwpp_other\",\"select\":[42453207],\"formId\":306147,\"dirty\":false,\"creationDate\":1475533590551,\"requireds\":[],\"index\":154,\"valueText\":\"Gateway Move » PwPP » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028647,\"value\":\"onb_gwmove_wells_other\",\"select\":[42453207],\"formId\":306147,\"dirty\":false,\"creationDate\":1475533571198,\"requireds\":[],\"index\":155,\"valueText\":\"Gateway Move » Wells » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028647,\"value\":\"onb_marketplace_other\",\"select\":[42453207],\"formId\":306147,\"dirty\":false,\"creationDate\":1475533547399,\"requireds\":[],\"index\":156,\"valueText\":\"Marketplace » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028647,\"value\":\"onb_other\",\"select\":[42453207],\"formId\":306147,\"dirty\":false,\"creationDate\":1475533599999,\"requireds\":[],\"index\":157,\"valueText\":\"Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":true},{\"field\":41028647,\"value\":\"onb_pricetemp_custom_other\",\"select\":[42453207],\"formId\":306147,\"dirty\":false,\"creationDate\":1475533499942,\"requireds\":[],\"index\":158,\"valueText\":\"Pricing Template » Custom » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028647,\"value\":\"onb_pricetemp_other\",\"select\":[42453207],\"formId\":306147,\"dirty\":false,\"creationDate\":1475533501327,\"requireds\":[],\"index\":159,\"valueText\":\"Pricing Template » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028647,\"value\":\"onb_settlement_change_other\",\"select\":[42453207],\"formId\":306147,\"dirty\":false,\"creationDate\":1475533502820,\"requireds\":[],\"index\":160,\"valueText\":\"Settlelment » Settlement Change » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41028647,\"value\":\"onb_settlement_other\",\"select\":[42453207],\"formId\":306147,\"dirty\":false,\"creationDate\":1475533504326,\"requireds\":[],\"index\":161,\"valueText\":\"Settlelment » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41106188,\"value\":\"sup_3rdparty_magento_other\",\"select\":[42453207],\"formId\":278927,\"dirty\":false,\"creationDate\":1475531854614,\"requireds\":[],\"index\":162,\"valueText\":\"Third Party Shopping Cart » Magento » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41106188,\"value\":\"sup_3rdparty_other\",\"select\":[42453207],\"formId\":278927,\"dirty\":false,\"creationDate\":1475531859982,\"requireds\":[],\"index\":163,\"valueText\":\"Third Party Shopping Cart » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41106188,\"value\":\"sup_acctchange_bankact_other\",\"select\":[42453207],\"formId\":278927,\"dirty\":false,\"creationDate\":1475531840214,\"requireds\":[],\"index\":164,\"valueText\":\"Account Change » Bank Account » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41106188,\"value\":\"sup_acctchange_credit_other\",\"select\":[42453207],\"formId\":278927,\"dirty\":false,\"creationDate\":1475531816879,\"requireds\":[],\"index\":165,\"valueText\":\"Account Change » Credits » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41106188,\"value\":\"sup_acctchange_desc_other\",\"select\":[42453207],\"formId\":278927,\"dirty\":false,\"creationDate\":1475531834614,\"requireds\":[],\"index\":166,\"valueText\":\"Account Change » Descriptor » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41106188,\"value\":\"sup_acctchange_other\",\"select\":[42453207],\"formId\":278927,\"dirty\":false,\"creationDate\":1475531845486,\"requireds\":[],\"index\":167,\"valueText\":\"Account Change » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41106188,\"value\":\"sup_comply_other\",\"select\":[42453207],\"formId\":278927,\"dirty\":false,\"creationDate\":1475531811471,\"requireds\":[],\"index\":168,\"valueText\":\"Compliance » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41106188,\"value\":\"sup_comply_pci_other\",\"select\":[42453207],\"formId\":278927,\"dirty\":false,\"creationDate\":1475531808222,\"requireds\":[],\"index\":169,\"valueText\":\"Compliance » PCI » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41106188,\"value\":\"sup_cpconfig_fraud_other\",\"select\":[42453207],\"formId\":278927,\"dirty\":false,\"creationDate\":1475531776871,\"requireds\":[],\"index\":170,\"valueText\":\"Control Panel Configuration » Fraud tools » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41106188,\"value\":\"sup_cpconfig_other\",\"select\":[42453207],\"formId\":278927,\"dirty\":false,\"creationDate\":1474479203939,\"requireds\":[42453207],\"index\":171,\"valueText\":\"Control Panel Configuration » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41106188,\"value\":\"sup_cpconfig_secur_other\",\"select\":[42453207],\"formId\":278927,\"dirty\":false,\"creationDate\":1475531769935,\"requireds\":[],\"index\":172,\"valueText\":\"Control Panel Configuration » Security » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41106188,\"value\":\"sup_cpconfig_userroles_other\",\"select\":[42453207],\"formId\":278927,\"dirty\":false,\"creationDate\":1475531773918,\"requireds\":[],\"index\":173,\"valueText\":\"Control Panel Configuration » Users and Roles » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41106188,\"value\":\"sup_integrat_3ds_other\",\"select\":[42453207],\"formId\":278927,\"dirty\":false,\"creationDate\":1475531923703,\"requireds\":[],\"index\":174,\"valueText\":\"Products/Integrations » 3DS » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41106188,\"value\":\"sup_integrat_android_other\",\"select\":[42453207],\"formId\":278927,\"dirty\":false,\"creationDate\":1475531935446,\"requireds\":[],\"index\":175,\"valueText\":\"Products/Integrations » Android » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41106188,\"value\":\"sup_integrat_ios_other\",\"select\":[42453207],\"formId\":278927,\"dirty\":false,\"creationDate\":1475531929342,\"requireds\":[],\"index\":176,\"valueText\":\"Products/Integrations » iOS » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41106188,\"value\":\"sup_integrat_jsweb_other\",\"select\":[42453207],\"formId\":278927,\"dirty\":false,\"creationDate\":1475531941262,\"requireds\":[],\"index\":177,\"valueText\":\"Products/Integrations » JS/Web » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41106188,\"value\":\"sup_integrat_kount_other\",\"select\":[42453207],\"formId\":278927,\"dirty\":false,\"creationDate\":1475531911783,\"requireds\":[],\"index\":178,\"valueText\":\"Products/Integrations » Kount » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41106188,\"value\":\"sup_integrat_legacy_other\",\"select\":[42453207],\"formId\":278927,\"dirty\":false,\"creationDate\":1475531918542,\"requireds\":[],\"index\":179,\"valueText\":\"Products/Integrations » Legacy Product » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41106188,\"value\":\"sup_integrat_mktplace_other\",\"select\":[42453207],\"formId\":278927,\"dirty\":false,\"creationDate\":1475531954646,\"requireds\":[],\"index\":180,\"valueText\":\"Products/Integrations » Marketplace » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41106188,\"value\":\"sup_integrat_other\",\"select\":[42453207],\"formId\":278927,\"dirty\":false,\"creationDate\":1475531966782,\"requireds\":[],\"index\":181,\"valueText\":\"Products/Integrations » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41106188,\"value\":\"sup_integrat_recurr_other\",\"select\":[42453207],\"formId\":278927,\"dirty\":false,\"creationDate\":1475531946238,\"requireds\":[],\"index\":182,\"valueText\":\"Products/Integrations » Recurring Billing » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41106188,\"value\":\"sup_integrat_webhook_other\",\"select\":[42453207],\"formId\":278927,\"dirty\":false,\"creationDate\":1475531962454,\"requireds\":[],\"index\":183,\"valueText\":\"Products/Integrations » Webhooks » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41106188,\"value\":\"sup_migration_export_other\",\"select\":[42453207],\"formId\":278927,\"dirty\":false,\"creationDate\":1475531979110,\"requireds\":[],\"index\":184,\"valueText\":\"Migration » Export » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41106188,\"value\":\"sup_migration_import_other\",\"select\":[42453207],\"formId\":278927,\"dirty\":false,\"creationDate\":1475531974055,\"requireds\":[],\"index\":185,\"valueText\":\"Migration » Import » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41106188,\"value\":\"sup_migration_other\",\"select\":[42453207],\"formId\":278927,\"dirty\":false,\"creationDate\":1475531984759,\"requireds\":[],\"index\":186,\"valueText\":\"Migration » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":true},{\"field\":41106188,\"value\":\"sup_nonbtserv_cardhold_other\",\"select\":[42453207],\"formId\":278927,\"dirty\":false,\"creationDate\":1475531765887,\"requireds\":[],\"index\":187,\"valueText\":\"Non Braintree Serviceable » Card Holder » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41106188,\"value\":\"sup_nonbtserv_other\",\"select\":[42453207],\"formId\":278927,\"dirty\":false,\"creationDate\":1475531768207,\"requireds\":[],\"index\":188,\"valueText\":\"Non Braintree Serviceable » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41106188,\"value\":\"sup_other\",\"select\":[42453207],\"formId\":278927,\"dirty\":false,\"creationDate\":1474479311021,\"requireds\":[42453207],\"index\":189,\"valueText\":\"Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41106188,\"value\":\"sup_paymethod_ach_other\",\"select\":[42453207],\"formId\":278927,\"dirty\":false,\"creationDate\":1475531877542,\"requireds\":[],\"index\":190,\"valueText\":\"Payment Methods » ACH » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41106188,\"value\":\"sup_paymethod_android_other\",\"select\":[42453207],\"formId\":278927,\"dirty\":false,\"creationDate\":1475531871894,\"requireds\":[],\"index\":191,\"valueText\":\"Payment Methods » Android Pay » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41106188,\"value\":\"sup_paymethod_apple_other\",\"select\":[42453207],\"formId\":278927,\"dirty\":false,\"creationDate\":1475531868726,\"requireds\":[],\"index\":192,\"valueText\":\"Payment Methods » Apple Pay » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41106188,\"value\":\"sup_paymethod_coinbase_other\",\"select\":[42453207],\"formId\":278927,\"dirty\":false,\"creationDate\":1475531894422,\"requireds\":[],\"index\":193,\"valueText\":\"Payment Methods » Coinbase/Bitcoin » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41106188,\"value\":\"sup_paymethod_pwpp_other\",\"select\":[42453207],\"formId\":278927,\"dirty\":false,\"creationDate\":1475531865126,\"requireds\":[],\"index\":194,\"valueText\":\"Payment Methods » PwPP » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41106188,\"value\":\"sup_paymethod_sepa_other\",\"select\":[42453207],\"formId\":278927,\"dirty\":false,\"creationDate\":1475531900238,\"requireds\":[],\"index\":195,\"valueText\":\"Payment Methods » SEPA » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41106188,\"value\":\"sup_paymethod_union_other\",\"select\":[42453207],\"formId\":278927,\"dirty\":false,\"creationDate\":1475531890078,\"requireds\":[],\"index\":196,\"valueText\":\"Payment Methods » Union Pay » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41106188,\"value\":\"sup_paymethod_venmo_other\",\"select\":[42453207],\"formId\":278927,\"dirty\":false,\"creationDate\":1475531885110,\"requireds\":[],\"index\":197,\"valueText\":\"Payment Methods » Venmo for Business » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41106188,\"value\":\"sup_proactive_other\",\"select\":[42453207],\"formId\":278927,\"dirty\":false,\"creationDate\":1475531905614,\"requireds\":[],\"index\":198,\"valueText\":\"Proactive Communication » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41106188,\"value\":\"sup_process_config_other\",\"select\":[42453207],\"formId\":278927,\"dirty\":false,\"creationDate\":1475531803751,\"requireds\":[],\"index\":199,\"valueText\":\"Processing » Configuration Issue » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41106188,\"value\":\"sup_process_fund_other\",\"select\":[42453207],\"formId\":278927,\"dirty\":false,\"creationDate\":1474479284718,\"requireds\":[42453207],\"index\":200,\"valueText\":\"Processing » Funding » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41106188,\"value\":\"sup_process_other\",\"select\":[42453207],\"formId\":278927,\"dirty\":false,\"creationDate\":1474479302951,\"requireds\":[42453207],\"index\":201,\"valueText\":\"Processing » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41106188,\"value\":\"sup_process_transaction_other\",\"select\":[42453207],\"formId\":278927,\"dirty\":false,\"creationDate\":1475531798510,\"requireds\":[],\"index\":202,\"valueText\":\"Processing » Transaction » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41106188,\"value\":\"sup_search_api_other\",\"select\":[42453207],\"formId\":278927,\"dirty\":false,\"creationDate\":1475531790182,\"requireds\":[],\"index\":203,\"valueText\":\"Searching/Reporting » API » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41106188,\"value\":\"sup_search_cp_other\",\"select\":[42453207],\"formId\":278927,\"dirty\":false,\"creationDate\":1475531785262,\"requireds\":[],\"index\":204,\"valueText\":\"Searching/Reporting » Control Panel » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41106188,\"value\":\"sup_search_other\",\"select\":[42453207],\"formId\":278927,\"dirty\":false,\"creationDate\":1475531794151,\"requireds\":[],\"index\":205,\"valueText\":\"Searching/Reporting » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41200807,\"value\":\"rsk_autorpt_aref_other\",\"select\":[42453207],\"formId\":369908,\"dirty\":false,\"creationDate\":1475533706094,\"requireds\":[],\"index\":206,\"valueText\":\"Automated Reports » Artefacts » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41200807,\"value\":\"rsk_autorpt_dispnotify_other\",\"select\":[42453207],\"formId\":369908,\"dirty\":false,\"creationDate\":1475533756014,\"requireds\":[],\"index\":207,\"valueText\":\"Automated Reports » Dispute Notifier/Arbiter (TBD) » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41200807,\"value\":\"rsk_compliance_g2_other\",\"select\":[42453207],\"formId\":369908,\"dirty\":false,\"creationDate\":1475533786974,\"requireds\":[],\"index\":208,\"valueText\":\"Compliance Risk » G2 » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41200807,\"value\":\"rsk_compliance_legal_other\",\"select\":[42453207],\"formId\":369908,\"dirty\":false,\"creationDate\":1475533793525,\"requireds\":[],\"index\":209,\"valueText\":\"Compliance Risk » Legal » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41200807,\"value\":\"rsk_compliance_ofac_other\",\"select\":[42453207],\"formId\":369908,\"dirty\":false,\"creationDate\":1475533790622,\"requireds\":[],\"index\":210,\"valueText\":\"Compliance Risk » OFAC » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41200807,\"value\":\"rsk_compliance_rother\",\"select\":[42453207],\"formId\":369908,\"dirty\":false,\"creationDate\":1475533796181,\"requireds\":[],\"index\":211,\"valueText\":\"Compliance Risk » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41200807,\"value\":\"rsk_compliance_website_other\",\"select\":[42453207],\"formId\":369908,\"dirty\":false,\"creationDate\":1475533783127,\"requireds\":[],\"index\":212,\"valueText\":\"Compliance Risk » Website » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41200807,\"value\":\"rsk_dispu_fraudtool_other\",\"select\":[42453207],\"formId\":369908,\"dirty\":false,\"creationDate\":1475533692326,\"requireds\":[],\"index\":213,\"valueText\":\"Disputes » Fraud Tools » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41200807,\"value\":\"rsk_dispu_inquir_other\",\"select\":[42453207],\"formId\":369908,\"dirty\":false,\"creationDate\":1475533689334,\"requireds\":[],\"index\":214,\"valueText\":\"Disputes » Inquiry » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41200807,\"value\":\"rsk_dispu_other\",\"select\":[42453207],\"formId\":369908,\"dirty\":false,\"creationDate\":1475533695878,\"requireds\":[],\"index\":215,\"valueText\":\"Disputes » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41200807,\"value\":\"rsk_manmonit_other\",\"select\":[42453207],\"formId\":369908,\"dirty\":false,\"creationDate\":1475533702750,\"requireds\":[],\"index\":216,\"valueText\":\"Manual Monitoring » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41200807,\"value\":\"rsk_nonmerch_crdhold_other\",\"select\":[42453207],\"formId\":369908,\"dirty\":false,\"creationDate\":1475533684334,\"requireds\":[],\"index\":217,\"valueText\":\"Non Merchant » Card Holder » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41200807,\"value\":\"rsk_nonmerch_other\",\"select\":[42453207],\"formId\":369908,\"dirty\":false,\"creationDate\":1475533687200,\"requireds\":[],\"index\":218,\"valueText\":\"Non Merchant » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41200807,\"value\":\"rsk_nonmerch_prospect_other\",\"select\":[42453207],\"formId\":369908,\"dirty\":false,\"creationDate\":1475533685999,\"requireds\":[],\"index\":219,\"valueText\":\"Non Merchant » Prospective » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41200807,\"value\":\"rsk_other\",\"select\":[42453207],\"formId\":369908,\"dirty\":false,\"creationDate\":1475533799542,\"requireds\":[],\"index\":220,\"valueText\":\"Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":true},{\"field\":41200807,\"value\":\"rsk_riskreviw_acctclose_other\",\"select\":[42453207],\"formId\":369908,\"dirty\":false,\"creationDate\":1475533766302,\"requireds\":[],\"index\":221,\"valueText\":\"Risk Review » Account Closure » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41200807,\"value\":\"rsk_riskreviw_fraudtool_other\",\"select\":[42453207],\"formId\":369908,\"dirty\":false,\"creationDate\":1475533760245,\"requireds\":[],\"index\":222,\"valueText\":\"Risk Review » Fraud Tools » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41200807,\"value\":\"rsk_riskreviw_fundhold_\",\"select\":[42453207],\"formId\":369908,\"dirty\":false,\"creationDate\":1475533776990,\"requireds\":[],\"index\":223,\"valueText\":\"Risk Review » Funding Hold » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41200807,\"value\":\"rsk_riskreviw_fundhold_other\",\"select\":[42453207],\"formId\":369908,\"dirty\":false,\"creationDate\":1475533779958,\"requireds\":[],\"index\":224,\"valueText\":\"Risk Review » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false},{\"field\":41200807,\"value\":\"rsk_watchlist_other\",\"select\":[42453207],\"formId\":369908,\"dirty\":false,\"creationDate\":1475533699870,\"requireds\":[],\"index\":225,\"valueText\":\"Watchlist » Other\",\"fieldsText\":\"Explain Why This Is \\\"Other\\\"\",\"selected\":false}]","rules_1":null,"user_rules":null,"user_rules_1":null},"requirements":[],"updated_at":"2016-10-03T22:36:22Z","created_at":"2016-09-09T15:15:13Z"});
    }

    ZendeskApps.sortAppsForSite("top_bar", [1044688,1114307]);
    ZendeskApps.sortAppsForSite("nav_bar", [1045328,1102847]);
    ZendeskApps.sortAppsForSite("ticket_sidebar", [1045028,1033708,1096827,1048708,1102847,1056148,1183627,1085328,1048688]);
    ZendeskApps.sortAppsForSite("new_ticket_sidebar", [1045028,1033708,1096827,1048708,1102847,1048688]);
}());

ZendeskApps.trigger && ZendeskApps.trigger('ready');
