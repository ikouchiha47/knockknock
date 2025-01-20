import { useState, useEffect, useRef } from "preact/hooks";
import { listen } from '@tauri-apps/api/event';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification
} from '@tauri-apps/plugin-notification';

import { TrayIcon } from '@tauri-apps/api/tray';
import { defaultWindowIcon } from '@tauri-apps/api/app';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Menu } from '@tauri-apps/api/menu';

import "./App.css";

function App() {
  const [notifications, setNotifications] = useState([]);
  const [firstLoad, setFirstLoad] = useState(false);
  const [activeTab, setActiveTab] = useState("ci_activity");
  const [groupedNotifications, doGroupNotification] = useState(null);

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


  useEffect(() => {
    const unlisten = listen("github-notification", (event) => {
      let recvdNotifications = event.payload || [];

      setFirstLoad(prevLoadState => {
        if (!prevLoadState) return true;
        return prevLoadState;
      })

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


  useEffect(async () => {
    const _groupedNotifications = {
      ci_activity: groupByTitle(notifications.filter((n) => n.reason === "ci_activity")),
      participating: groupByTitle(notifications.filter((n) => n.reason === "participating")),
      review_requested: groupByTitle(notifications.filter((n) => n.reason === "review_requested")),
      rest: groupByTitle(notifications.filter(
        (n) => !["ci_activity", "participating", "review_requested"].includes(n.reason)
      )),
    };

    doGroupNotification(_groupedNotifications);

    if (firstLoad)
      await notify({
        title: 'Yo',
        body: `There is a new github activity`,
      })

  }, [notifications])

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

  // const renderNotifications = (group) => {
  //   if (group.length === 0 && firstLoad) {
  //     return <p className="emptyState">No notifications in this category. 💤</p>;
  //   }
  //
  //   if (group.length == 0 && !firstLoad) {
  //     return <p className="emptyState">Fetching Notifications... 🚀</p>;
  //   }
  //
  //   return (
  //     <ul className="notification-list">
  //       {group.map((notification, index) => (
  //         <li key={index} className="notification-item">
  //           <strong>{notification.subject.title}</strong>
  //           <em className="repo-name">{notification.repository.full_name}</em>
  //         </li>
  //       ))}
  //     </ul>
  //   );
  // };


  const renderNotifications = (group) => {
    const titles = Object.keys(group);

    if (titles.length === 0 && firstLoad) {
      return <p className="emptyState">No notifications in this category. 💤</p>;
    }

    if (titles.length === 0 && !firstLoad) {
      return <p className="emptyState">Fetching Notifications... 🚀</p>;
    }

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
                    <em className="repo-name">{notification.repository.full_name}</em>
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

      <div className="tabs">
        {["ci_activity", "participating", "review_requested", "rest"].map((tab) => (
          <button
            key={tab}
            className={["tab-button", activeTab == tab ? "activeTabButton" : ""].join(" ").trim()}
            onClick={() => setActiveTab(tab)}
          >
            {tab.replace("_", " ").toUpperCase()}
          </button>
        ))}
      </div>

      {/* Notifications */}
      <div style={{ marginTop: '16px' }}>
        {groupedNotifications && renderNotifications(groupedNotifications[activeTab])}
      </div>
    </main>
  );
}

export default App;
