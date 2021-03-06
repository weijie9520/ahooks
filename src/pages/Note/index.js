import React, {
  useState,
  useCallback,
  useMemo,
  useRef,
  useEffect,
} from 'react';
import { v4 as uuid } from 'uuid';
import useUpdateEffect from './hooks/useUpdateEffect';
import Parse from './Parse/index';
import styles from './index.less';
import { get } from 'lodash';

const handleGetLevel = (node, TopNode) => {
  const list = [];
  while (node !== TopNode) {
    const parent = node.parentNode;
    const children = parent.childNodes;
    for (let i = 0; i < children.length; i++) {
      if (node === children[i]) {
        list.push(i);
        break;
      }
    }
    node = parent;
  }
  return list.reverse();
};

// 如果外层有 custom-split 节点， 表示当前节点为自定义分割节点，取最近的一层
// 如果没有就取当前节点
const getShortestCustomNode = (startContainer, noteContainer) => {
  let node = startContainer;
  let lastNode = startContainer;

  while (node && node !== noteContainer) {
    const isCustom =
      node.getAttribute && node.getAttribute('data-custom-split');
    if (isCustom) {
      lastNode = node;
      break;
    }
    node = node.parentNode;
  }

  return lastNode;
};

// 分割节点作为一个整体判断
const parseCustomSplitNode = ({ node, isStart = false, range }) => {
  const {
    commonAncestorContainer,
    endContainer,
    endOffset,
    startContainer,
    startOffset,
  } = range;

  const info = {};

  if (isStart) {
    info.isStart = true;
    info.start = 0;
  } else if (node.contains(startContainer)) {
    info.isStart = true;
    let startNode = startContainer;
    let offset = 0;
    outer: while (startNode && startNode !== node) {
      if (startNode === startContainer) {
        offset += startOffset;
      } else {
        offset += startNode?.textContent?.length || 0;
      }

      if (startNode.previousSibling) {
        startNode = startNode.previousSibling;
      } else {
        do {
          startNode = startNode.parentNode;
          if (node === startNode) {
            break outer;
          }
        } while (!startNode.previousSibling);
        startNode = startNode.previousSibling;
      }
    }

    info.start = offset;
  }

  if (node.contains(endContainer)) {
    info.isEnd = true;
    let endNode = endContainer;

    let offset = 0;
    outer: while (endNode && endNode !== node) {
      if (endNode === endContainer) {
        offset += endOffset;
      } else {
        offset += endNode?.textContent?.length || 0;
      }

      if (endNode.previousSibling) {
        endNode = endNode.previousSibling;
      } else {
        do {
          endNode = endNode.parentNode;
          if (node === endNode) {
            break outer;
          }
        } while (!endNode.previousSibling);
        endNode = endNode.previousSibling;
      }
    }
    info.end = offset;
  } else if (isStart) {
    info.isEnd = false;
    info.end = node.textContent.length;
  }

  return info;
};

const getAllContainerNodeLevel = ({ range, noteContainer }) => {
  const {
    commonAncestorContainer,
    endContainer,
    endOffset,
    startContainer,
    startOffset,
  } = range;

  const commonContainer = getShortestCustomNode(
    commonAncestorContainer,
    noteContainer,
  );

  const topLevel = handleGetLevel(commonContainer, noteContainer);

  let node = getShortestCustomNode(startContainer, noteContainer);

  let isStart = false;
  let isEnd = false;
  let list = [];
  let customNodeInfo = {};

  outer: while (node && !isEnd) {
    // 所有分割文本上都多嵌套了一层 span ，添加自定义属性 data-custom-split
    // 文本节点木有获取属性
    const isCustom =
      node.getAttribute && node.getAttribute('data-custom-split');

    // TODO 需要判断当前是否为自定义分割节点，为分割节点的情况，需要到内部去判断当前是否为开始节点与结束节点
    if (isCustom) {
      customNodeInfo = parseCustomSplitNode({ range, isStart, node });
      isStart = customNodeInfo.isStart;
      isEnd = customNodeInfo.isEnd;
    } else {
      if (node === startContainer) {
        isStart = true;
      }
      if (node === endContainer) {
        isEnd = true;
      }
    }
    // 选中开始节点 - 选中的结束节点 之间的文本节点都为选中文本
    if (isStart) {
      const level = handleGetLevel(node, commonContainer);
      // 只标记文本节点
      if (node.nodeType === 3) {
        let textStartOffset = 0;
        let textEndOffset = node.textContent.length;

        if (node === startContainer) {
          textStartOffset = startOffset;
        }

        if (node === endContainer) {
          textEndOffset = endOffset;
        }

        list.push({
          uuid: uuid(),
          level: [...topLevel, ...level],
          start: textStartOffset,
          end: textEndOffset,
          text: node.textContent.slice(textStartOffset, textEndOffset),
        });
      } else if (isCustom) {
        const { start = 0, end = 0 } = customNodeInfo;

        list.push({
          uuid: uuid(),
          level: [...topLevel, ...level],
          start: start,
          end: end,
          text: node.textContent.slice(start, end),
        });
        // TODO 综合当前节点选中文本 ， 待完善
      }
    }

    // 自定义节点为最底层的文本节点，逻辑上无法分割， 所以转到查询兄弟节点
    if (node.childNodes.length && !isCustom) {
      node = node.childNodes[0];
    } else if (node.nextSibling) {
      node = node.nextSibling;
    } else {
      do {
        node = node.parentNode;
        if (noteContainer === node) {
          break outer;
        }
      } while (!node.nextSibling);
      node = node.nextSibling;
    }
  }

  return list.filter(item => {
    return item.text && item.text.trim();
  });
};

const Note = ({ template, value, onChange }) => {
  const parse = useMemo(() => {
    // 用于格式化html文本
    if (template) {
      const div = document.createElement('div');
      div.innerHTML = template;
      template = div.innerHTML;
    }

    return new Parse({ template: template || '' });
  }, []);

  const [snapShoot, setSnapShoot] = useState(() => {
    return { __html: parse.getHTML(value) };
  });
  const noteContainer = useRef();

  const handleMouseDown = useCallback(
    e => {
      if (!noteContainer.current) return;
      document.addEventListener(
        'mouseup',
        event => {
          const range = window.getSelection().getRangeAt(0);

          const { collapsed, endContainer, startContainer } = range;

          // 返回条件 1. 光标起始点相同（即没有选中文本），2. 起点或者终点不在当前容器内
          if (
            collapsed ||
            !noteContainer.current.contains(startContainer) ||
            !noteContainer.current.contains(endContainer)
          )
            return;

          const list = getAllContainerNodeLevel({
            range,
            noteContainer: noteContainer.current,
          });
          console.log('list:', list);
          onChange && onChange(list);
        },
        {
          once: true,
        },
      );
    },
    [noteContainer, parse],
  );

  const handleClick = useCallback(() => {}, []);

  useUpdateEffect(() => {
    setSnapShoot({ __html: parse.getHTML(value) });
  }, [setSnapShoot, parse, value]);

  return (
    <div
      onClick={handleClick}
      className={styles.note}
      ref={noteContainer}
      onMouseDown={handleMouseDown}
      dangerouslySetInnerHTML={snapShoot}
    ></div>
  );
};

export default Note;
