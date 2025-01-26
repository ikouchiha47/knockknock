import { useState, useEffect, useRef } from "preact/hooks";
import { listen } from '@tauri-apps/api/event';
import {
  requestPermission,
  sendNotification
} from '@tauri-apps/plugin-notification';

import { TrayIcon } from '@tauri-apps/api/tray';
import { defaultWindowIcon } from '@tauri-apps/api/app';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Menu } from '@tauri-apps/api/menu';

import { register, unregisterAll } from '@tauri-apps/plugin-global-shortcut';

import "./App.css";

const _M = {
  isInvolved: (category) => [
    "review_requested",
    "assign",
    "approval_requested",
    "participating",
  ].includes(category),

  getLinkFor: (category, repository, url) => {
    if (_M.isInvolved(category) && repository) {
      const u = new URL(url);
      const prID = Number(u.pathname.split('/').at(-1))
      const repoName = repository.full_name
      const htmlUrl = new URL(repository.html_url)


      if (!prID || isNaN(prID)) {
        return "#"
      }

      let resource = category == "review_requested" ? "pull" : "issues";

      return `${htmlUrl.origin}/${repoName}/${resource}/${prID}`
    }

    return "#"
  },

  isDirty: (groupsCounts, group) => {
    let groupCount = groupsCounts.find(gcount => gcount.key == group);
    return groupCount ? groupCount.dirty : false;
  }
}


function App() {
  const [notifications, setNotifications] = useState([]);
  const [firstLoad, setFirstLoad] = useState(false);
  const [activeTab, setActiveTab] = useState("ci_activity");
  const [groupedNotifications, doGroupNotification] = useState(null);
  const [groupCounts, setGroupCount] = useState([
    { key: 'ci_activity', ci_activity: 0, dirty: false },
    { key: 'review_requested', review_requested: 0, dirty: false },
    { key: 'rest', rest: 0, dirty: false },
    // { key: 'participating', participating: 0, dirty: false },
  ]);

  const [shortcutKey, setShortcutKey] = useState('N');

  let permissionRef = useRef(false);
  const currentWindow = useRef(null);

  const notify = async (args) => {
    if (permissionRef && !permissionRef.current) {
      const permission = await requestPermission();
      permissionRef.current = permission === 'granted';
    }

    sendNotification(args)
  }

  const toggleWindow = async (currWindow, fnKey) => {
    currWindow[fnKey] ? await currWindow[fnKey]() : await Promise.reject("")
    if (fnKey == 'show') {
      await currWindow.setVisibleOnAllWorkspaces(true)
    }
  }

  const handleTrayClick = async (itemId) => {
    if (!currentWindow.current) return;

    let visible = await currentWindow.current.isVisible();

    switch (itemId) {
      case 'toggle':
        if (visible) {
          await toggleWindow(currentWindow.current, 'hide')
        } else {
          await toggleWindow(currentWindow.current, 'show')
        }

        break;
      case 'quit':
        await toggleWindow(currentWindow.current, 'close')
        break;
      default:
        break;
    }
  };

  const initializeTray = async () => {
    try {
      const menu = await Menu.new({
        items: [
          { text: 'toggle', id: 'toggle', action: handleTrayClick },
          { text: 'quit', id: 'quit', action: handleTrayClick },
        ]
      })

      const tray = await TrayIcon.new({
        icon: await defaultWindowIcon(),
        menu,
        menuOnLeftClick: true,
      });

      currentWindow.current = getCurrentWindow()

      await currentWindow.current.hide()
      return tray

    } catch (e) {
      console.log("error: Failed to setup tray")
      console.log(e)
    }
  };

  useEffect(async () => {
    if (!currentWindow) return;

    let tray = await initializeTray();

    return async () => {
      await TrayIcon.removeById(tray.id)
    }
  }, [])


  const registerShortcuts = async (key) => {
    // global shortcut
    if (!key.trim()) return;

    await register(`CommandOrControl+Shift+${key}`, async (e) => {
      if (e.state === "Pressed") return;

      let currWindow = currentWindow && currentWindow.current;
      // let currWindow = getCurrentWindow();
      let isVisible = await currWindow.isVisible()
      if (isVisible) {
        await toggleWindow(currWindow, 'hide')
        return
      }

      await toggleWindow(currWindow, 'show');
    })
  };

  useEffect(() => {
    const setupShortcuts = async () => {
      try {
        console.log("setting shortcut", shortcutKey)
        await registerShortcuts(shortcutKey);
      } catch (e) {
        console.log("error", e)
      }
    }

    setupShortcuts();

    return async () => {
      await unregisterAll();
    }

  }, [shortcutKey])

  useEffect(() => {
    const unlisten = listen("github-notification", (event) => {
      let recvdNotifications = event.payload || [];

      setNotifications((prevNotifications) => {
        const changedNotifications = new Set([
          ...recvdNotifications.filter(notif => prevNotifications.findIndex(n => n.id == notif.id) < 0)]);


        if (changedNotifications.size == 0) {
          return prevNotifications;
        }

        let mergedNotifications = [...changedNotifications, ...prevNotifications];
        return mergedNotifications;
      })
    });

    return () => {
      unlisten.then((unsub) => unsub());
    };
  }, []);

  const toCategory = (reason) => {
    if (_M.isInvolved(reason)) return 'review_requested';
    if ('ci_activity' == reason) return reason;
    return 'rest'
  }

  useEffect(async () => {
    const _groupedNotifications = {
      ci_activity: groupByTitle(notifications.filter((n) => toCategory(n.reason))),
      review_requested: groupByTitle(notifications.filter((n) => _M.isInvolved(n.reason))),
      rest: groupByTitle(notifications.filter((n) => toCategory(n.reason))),
      // participating: groupByTitle(notifications.filter((n) => toCategory(n.reason))),
    };

    // console.log("nuts", notifications)
    doGroupNotification(_groupedNotifications);
    setGroupCount(prevGCounts => {
      let newGroupCount = notifications.
        reduce((acc, n) => {
          let category = toCategory(n.reason);
          return { ...acc, [category]: (acc[category] || 0) + 1 }
        }, {})

      window._gg = notifications
      console.log("new group count", newGroupCount, prevGCounts,);

      let results = prevGCounts.map((groupCount, i) => {
        let _gcount = { ...groupCount };

        let groupKey = _gcount.key;
        if (_gcount[groupKey] !== newGroupCount[groupKey]) {
          _gcount.dirty = true
        }

        return _gcount;
      })

      return results;
    });

    if (firstLoad)
      await notify({
        title: 'Yo',
        body: `There is a new github activity`,
      })

  }, [notifications])

  // useEffect(() => {
  //   if (!firstLoad && notifications.length == 0) return;
  //
  // }, [groupCounts])

  const groupByTitle = (notifications) => {
    return notifications.reduce((acc, curr) => {
      const title = curr.subject.title;
      const repo = curr.repository.full_name;

      const key = `${title}_${repo}`

      if (!acc[key]) {
        acc[key] = { count: 0, title: title, details: [curr] };
      }

      acc[key].count += 1;

      // if (acc[key].count == 1)
      //   acc[key].details.push(curr);

      return acc;
    }, {});
  }

  const renderNotifications = (category, group) => {
    const titles = Object.keys(group);

    if (titles.length === 0 && firstLoad) {
      return <p className="emptyState">No notifications in this category. 💤</p>;
    }

    if (titles.length === 0 && !firstLoad) {
      return <p className="emptyState">Fetching Notifications... 🚀</p>;
    }

    useEffect(() => {
      if (!firstLoad && notifications.length == 0) return;

      setFirstLoad(prevLoadState => {
        if (!prevLoadState) return true;
        return prevLoadState;
      })
    }, [])

    return (
      <ul className="notification-list">
        {titles.map((key) => {
          let groupItem = group[key];

          return (
            <li key={key} className="notification-item">
              <strong>
                {groupItem.title} <span className="count">({groupItem.count})</span>
              </strong>
              <ul className="sub-list">
                {groupItem.details.map((notification, index) => (
                  <li key={index} className="notification-sub-item">
                    <a
                      className="repo-name"
                      href={_M.getLinkFor(
                        category,
                        notification.repoistory,
                        notification.subject.url,
                      )}>{notification.repository.full_name}</a>
                  </li>
                ))}
              </ul>
            </li>
          )
        }
        )}
      </ul>
    );
  };

  return (
    <main className="container">
      <h1>GitHub Notifications</h1>

      <div className="row" id="shortcut">
        <span id="shortcut__title">Shortcut: Cmd/Ctrl+Shift</span>
        <input
          type="text"
          value={shortcutKey}
          onChange={(e) => {
            e.preventDefault();
            setShortcutKey(e.target.value)
          }} />
      </div>
      <div className="tabs">
        {groupCounts.map(gcount => gcount.key).map((tab) => (
          <button
            key={tab}
            className={[
              "tab-button",
              activeTab == tab ? "activeTabButton" : "",
              _M.isDirty(groupCounts, tab) ? "updated" : "",
            ].join(" ").trim()}
            onClick={() => setActiveTab(tab)}
          >
            {tab.replace("_", " ").toUpperCase()}
          </button>
        ))}
      </div>

      {/* Notifications */}
      <div style={{ marginTop: '16px' }}>
        {groupedNotifications && renderNotifications(activeTab, groupedNotifications[activeTab])}
      </div>
    </main>
  );
}

export default App;
